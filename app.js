const queryInput = document.getElementById('queryInput');
const searchBtn = document.getElementById('searchBtn');
const daysInput = document.getElementById('daysInput');
const sortSelect = document.getElementById('sortSelect');
const statusText = document.getElementById('statusText');
const resultsEl = document.getElementById('results');
const recommendBtns = document.querySelectorAll('.recommend-btn');
const savedListEl = document.getElementById('savedList');
const savedStatusEl = document.getElementById('savedStatus');

const SAVED_KEY = 'nogo_saved_papers';
let savedItems = loadSavedItems();

renderSavedList();

searchBtn.addEventListener('click', () => runSearch(queryInput.value.trim()));
queryInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    runSearch(queryInput.value.trim());
  }
});

recommendBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const term = btn.dataset.term || '';
    queryInput.value = term;
    runSearch(term);
  });
});

function buildDateRange(daysBack) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - daysBack);

  const startText = `${start.getFullYear()}/${String(start.getMonth() + 1).padStart(2, '0')}/${String(start.getDate()).padStart(2, '0')}`;
  const endText = `${end.getFullYear()}/${String(end.getMonth() + 1).padStart(2, '0')}/${String(end.getDate()).padStart(2, '0')}`;
  return { startText, endText };
}

async function runSearch(term) {
  if (!term) {
    statusText.textContent = '검색어를 먼저 입력해 주세요.';
    return;
  }

  const days = Number(daysInput.value) || 365;
  const sort = sortSelect.value || 'pub+date';
  const { startText, endText } = buildDateRange(days);

  statusText.textContent = '논문을 찾는 중입니다...';
  resultsEl.innerHTML = '';

  try {
    const ids = await searchPubMedIds(term, sort, startText, endText);
    if (ids.length === 0) {
      statusText.textContent = '조건에 맞는 논문이 없습니다.';
      return;
    }

    const papers = await fetchPaperDetails(ids);
    renderResults(papers);
    statusText.textContent = `총 ${papers.length}건을 불러왔습니다.`;
  } catch (error) {
    console.error(error);
    statusText.textContent = '불러오기 중 오류가 생겼습니다. 잠시 후 다시 시도해 주세요.';
  }
}

async function searchPubMedIds(term, sort, startDate, endDate) {
  const params = new URLSearchParams({
    db: 'pubmed',
    retmode: 'json',
    retmax: '20',
    term,
    sort,
    datetype: 'pdat',
    mindate: startDate,
    maxdate: endDate,
  });

  const response = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`);
  if (!response.ok) {
    throw new Error('esearch request failed');
  }
  const data = await response.json();
  return data.esearchresult?.idlist || [];
}

async function fetchPaperDetails(idList) {
  const params = new URLSearchParams({
    db: 'pubmed',
    id: idList.join(','),
    retmode: 'xml',
  });

  const response = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params.toString()}`);
  if (!response.ok) {
    throw new Error('efetch request failed');
  }

  const xmlText = await response.text();
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  const articles = [...xml.querySelectorAll('PubmedArticle')];

  return articles.map((article) => {
    const pmid = textOf(article, 'PMID');
    const title = textOf(article, 'ArticleTitle') || '(제목 없음)';

    const authorNodes = [...article.querySelectorAll('Author')]
      .map((author) => {
        const lastName = textOf(author, 'LastName');
        const initials = textOf(author, 'Initials');
        if (!lastName) return '';
        return initials ? `${lastName} ${initials}` : lastName;
      })
      .filter(Boolean);

    const authors = authorNodes.length > 0 ? authorNodes.join(', ') : '저자 정보 없음';

    const journal = textOf(article, 'Journal > Title') || '저널 정보 없음';
    const year = textOf(article, 'PubDate > Year') || textOf(article, 'ArticleDate > Year') || '연도 정보 없음';

    const abstractParts = [...article.querySelectorAll('AbstractText')]
      .map((node) => node.textContent?.trim() || '')
      .filter(Boolean);

    return {
      pmid,
      title,
      authors,
      journal,
      year,
      abstract: abstractParts.length > 0 ? abstractParts.join('\n\n') : '초록 정보 없음',
    };
  });
}

function renderResults(papers) {
  resultsEl.innerHTML = '';
  const fragment = document.createDocumentFragment();

  papers.forEach((paper) => {
    const card = createPaperCard(paper, false);
    fragment.appendChild(card);
  });

  resultsEl.appendChild(fragment);
}

function createPaperCard(paper, isSavedList) {
  const card = document.createElement('article');
  card.className = 'card';

  const title = document.createElement('h3');
  title.textContent = paper.title;

  const authors = document.createElement('p');
  authors.className = 'meta';
  authors.textContent = `저자: ${paper.authors}`;

  const journal = document.createElement('p');
  journal.className = 'meta';
  journal.textContent = `${paper.journal} / ${paper.year}`;

  const pmidLink = document.createElement('a');
  pmidLink.href = `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`;
  pmidLink.target = '_blank';
  pmidLink.rel = 'noopener noreferrer';
  pmidLink.textContent = `PMID: ${paper.pmid}`;

  const abstractToggle = document.createElement('button');
  abstractToggle.textContent = '초록 펼치기';

  const abstract = document.createElement('div');
  abstract.className = 'abstract';
  abstract.hidden = true;
  abstract.textContent = paper.abstract;

  abstractToggle.addEventListener('click', () => {
    abstract.hidden = !abstract.hidden;
    abstractToggle.textContent = abstract.hidden ? '초록 펼치기' : '초록 접기';
  });

  const actionRow = document.createElement('div');
  actionRow.className = 'action-row';
  actionRow.appendChild(abstractToggle);

  if (isSavedList) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'delete-btn';
    removeBtn.textContent = '저장 삭제';
    removeBtn.addEventListener('click', () => {
      savedItems = savedItems.filter((item) => item.pmid !== paper.pmid);
      persistSavedItems();
      renderSavedList();
    });
    actionRow.appendChild(removeBtn);
  } else {
    const saveBtn = document.createElement('button');
    saveBtn.textContent = isAlreadySaved(paper.pmid) ? '저장됨' : '저장';
    saveBtn.disabled = isAlreadySaved(paper.pmid);

    saveBtn.addEventListener('click', () => {
      if (isAlreadySaved(paper.pmid)) return;
      savedItems.unshift(paper);
      persistSavedItems();
      renderSavedList();
      saveBtn.textContent = '저장됨';
      saveBtn.disabled = true;
    });

    actionRow.appendChild(saveBtn);
  }

  card.append(title, authors, journal, pmidLink, actionRow, abstract);
  return card;
}

function renderSavedList() {
  savedListEl.innerHTML = '';

  if (savedItems.length === 0) {
    savedStatusEl.textContent = '저장한 논문이 없습니다.';
    return;
  }

  savedStatusEl.textContent = `저장한 논문 ${savedItems.length}건`;

  const fragment = document.createDocumentFragment();
  savedItems.forEach((paper) => {
    fragment.appendChild(createPaperCard(paper, true));
  });

  savedListEl.appendChild(fragment);
}

function loadSavedItems() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedItems() {
  localStorage.setItem(SAVED_KEY, JSON.stringify(savedItems));
}

function isAlreadySaved(pmid) {
  return savedItems.some((item) => item.pmid === pmid);
}

function textOf(root, selector) {
  const node = root.querySelector(selector);
  return node?.textContent?.trim() || '';
}

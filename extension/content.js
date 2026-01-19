/**
 * [Scholar IF & Renamer] 통합 컨텐츠 스크립트 (네트워크 강화 버전)
 * - 타임아웃 연장: 3초 -> 10초
 * - 재시도 로직(Retry): 실패 시 최대 2회 자동 재시도
 * - 안정성: API 요청 실패 시에도 UI가 깨지지 않도록 방어
 */

const apiCache = new Map();

// 동시 처리를 제어하기 위한 큐 시스템
const requestQueue = [];
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 3; 

// 큐 처리 함수
function processQueue() {
    if (activeRequests >= MAX_CONCURRENT_REQUESTS || requestQueue.length === 0) return;

    const task = requestQueue.shift();
    activeRequests++;

    task().finally(() => {
        activeRequests--;
        processQueue(); 
    });
    
    processQueue(); 
}

// 큐 등록 함수
function scheduleApiRequest(fn) {
    return new Promise((resolve) => {
        requestQueue.push(async () => {
            try {
                const result = await fn();
                resolve(result);
            } catch (err) {
                resolve(null);
            }
        });
        processQueue();
    });
}

// 한국어 포함 여부 체크
function containsKorean(text) {
    return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text);
}

// 1. 학술지 이름 정규화
function normalizeName(name) {
    if (!name) return "";
    return name.toUpperCase()
        .replace(/&/g, "AND")
        .replace(/\bTHE\b|\bOF\b|\bAND\b|\bFOR\b/g, "")
        .replace(/[\u2026]|\.{3}/g, "")
        .replace(/[^A-Z0-9]/g, "")
        .trim();
}

// [NEW] 타임아웃 기능이 있는 Fetch 함수
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 10000 } = options; // 10초로 연장
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// 2. CrossRef API (재시도 로직 포함)
async function fetchFullJournalNames(paperTitle) {
    if (!paperTitle) return [];
    if (apiCache.has(paperTitle)) return apiCache.get(paperTitle);

    const url = `https://api.crossref.org/works?query.title=${encodeURIComponent(paperTitle)}&rows=1`; // 정확도 위해 1개만
    const maxRetries = 2; // 최대 2번 더 시도

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetchWithTimeout(url, { cache: "force-cache" });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            
            if (data.status === "ok" && data.message.items.length > 0) {
                const names = [...new Set(data.message.items
                    .map(item => item['container-title']?.[0])
                    .filter(name => !!name))];
                
                if (names.length > 0) {
                    apiCache.set(paperTitle, names);
                    return names;
                }
            }
            // 결과가 없으면(빈 배열) 즉시 리턴 (재시도 안함)
            return [];
            
        } catch (err) {
            // 마지막 시도였다면 빈 배열 반환
            if (attempt === maxRetries) return [];
            // 실패 시 1초 대기 후 재시도 (Exponential Backoff 대신 단순 대기)
            await new Promise(res => setTimeout(res, 1000));
        }
    }
    return [];
}

// [기능 1] Impact Factor 표시 로직
async function injectIF() {
    try {
        const response = await fetch(chrome.runtime.getURL('data.json'));
        const ifData = await response.json();
        
        const normalizedDB = {};
        for (const key in ifData) {
            const normKey = normalizeName(key);
            normalizedDB[normKey] = { ...ifData[key], originalName: key };
        }

        const rows = document.querySelectorAll('.gs_r.gs_or.gs_scl, .gsc_a_tr'); 
        
        rows.forEach(async (row) => {
            let infoRow, titleNode, paperTitle, journalCandidate, isTruncated = false;

            if (row.getAttribute('data-if-processed') === 'true') return;
            if (row.querySelector('.scholar-if-display')) return;

            // 구글 스칼라 검색 결과
            if (row.classList.contains('gs_r')) {
                infoRow = row.querySelector('.gs_a');
                titleNode = row.querySelector('.gs_rt a');
                if (!infoRow) return;

                const text = infoRow.innerText;
                const parts = text.split(/[–—\-]/).map(p => p.trim());
                paperTitle = titleNode ? titleNode.innerText : "";
                isTruncated = text.includes('…') || text.includes('...');

                if (parts.length >= 2) {
                    journalCandidate = parts[1].split(',')[0].trim();
                    if (/^\d{4}$/.test(journalCandidate) && parts[2]) {
                        journalCandidate = parts[2].split(',')[0].trim();
                    }
                }
            } 
            // 구글 스칼라 프로필
            else if (row.classList.contains('gsc_a_tr')) {
                const infoDivs = row.querySelectorAll('.gsc_a_t .gs_gray');
                if (infoDivs.length < 2) return;
                
                infoRow = infoDivs[1];
                titleNode = row.querySelector('.gsc_a_at');
                paperTitle = titleNode ? titleNode.innerText : "";
                journalCandidate = infoRow.innerText.split(',')[0].trim();
                isTruncated = infoRow.innerText.includes('…') || infoRow.innerText.includes('...');
            }

            if (!journalCandidate || !infoRow) return;
            if (containsKorean(paperTitle) || containsKorean(journalCandidate)) {
                row.setAttribute('data-if-processed', 'true');
                return;
            }

            // [Volume Cleaner]
            if (journalCandidate) {
                journalCandidate = journalCandidate.replace(/\s+(\d+(\s*\(\d+\))?|\(\d+\))$/, "").trim();
            }

            row.setAttribute('data-if-processed', 'true');

            let matches = [];
            let apiResultName = null;
            const normalizedJournal = normalizeName(journalCandidate);

            const findExact = (normName) => normalizedDB[normName] || null;
            const findFuzzy = (normName) => {
                if (!normName || normName.length < 4) return null;
                const prefixKey = Object.keys(normalizedDB).find(key => key.startsWith(normName));
                if (prefixKey) return normalizedDB[prefixKey];
                const fuzzyKey = Object.keys(normalizedDB).find(key => {
                    if (key.length > 15 && normName.length > 15) {
                        return key.includes(normName) || normName.includes(key);
                    }
                    return false;
                });
                return fuzzyKey ? normalizedDB[fuzzyKey] : null;
            };

            // [Step 1] 동기 매칭
            if (!isTruncated) {
                const exactMatch = findExact(normalizedJournal);
                if (exactMatch) matches.push(exactMatch);
            }

            // [Step 2] API 어시스트 (큐 + 재시도 적용)
            if (matches.length === 0 && paperTitle) {
                const apiJournalNames = await scheduleApiRequest(() => fetchFullJournalNames(paperTitle));
                
                if (apiJournalNames && apiJournalNames.length > 0) {
                    apiResultName = apiJournalNames[0]; // 첫 번째 결과 저장
                    for (const name of apiJournalNames) {
                        const match = findExact(normalizeName(name));
                        if (match) {
                            if (!matches.some(m => m.originalName === match.originalName)) {
                                matches.push(match);
                                break;
                            }
                        }
                    }
                } else {
                    // API 실패 또는 결과 없음 시 Step 3
                    if (matches.length === 0 && isTruncated) {
                        const luckyMatch = findExact(normalizedJournal);
                        if (luckyMatch) matches.push(luckyMatch);
                        else {
                            const fuzzyMatch = findFuzzy(normalizedJournal);
                            if (fuzzyMatch) matches.push(fuzzyMatch);
                        }
                    }
                }
            }

            // UI 렌더링
            const resContainer = document.createElement('span');
            resContainer.className = 'scholar-if-display';
            resContainer.style.marginLeft = '8px';
            resContainer.style.display = 'inline-flex';
            resContainer.style.alignItems = 'center';

            if (matches.length >= 1) {
                const m = matches[0];
                
                const ifText = document.createElement('span');
                ifText.style.color = '#d93025';
                ifText.style.fontWeight = 'bold';
                ifText.style.fontSize = '12px';
                ifText.style.cursor = 'help';
                ifText.innerText = `IF ${m.if}`;
                ifText.title = `[매칭된 저널: ${m.originalName}]`; 
                resContainer.appendChild(ifText);

                if (m.q === 'Q1' && m.rank && m.rank.includes('/')) {
                    const [rank, total] = m.rank.split('/').map(num => parseInt(num.trim()));
                    if (!isNaN(rank) && !isNaN(total)) {
                        const topPercent = Math.ceil((rank / total) * 100);
                        
                        const q1Badge = document.createElement('span');
                        q1Badge.style.background = 'linear-gradient(135deg, #FFD700 0%, #FDB931 25%, #FFFACD 50%, #FDB931 75%, #FFD700 100%)';
                        q1Badge.style.backgroundSize = '200% auto';
                        q1Badge.style.border = '1px solid #DAA520';
                        q1Badge.style.color = '#000000';
                        q1Badge.style.padding = '1px 6px';
                        q1Badge.style.borderRadius = '4px';
                        q1Badge.style.fontSize = '10px';
                        q1Badge.style.fontWeight = '800';
                        q1Badge.style.marginLeft = '6px';
                        q1Badge.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.4)';
                        q1Badge.style.textShadow = '0.5px 0.5px 0px rgba(255,255,255,0.5)';
                        q1Badge.style.whiteSpace = 'nowrap';
                        q1Badge.style.cursor = 'help';
                        q1Badge.innerText = `TOP ${topPercent}%`;
                        q1Badge.title = `[매칭된 저널: ${m.originalName}] (순위: ${m.rank})`;
                        resContainer.appendChild(q1Badge);
                    }
                }
                infoRow.appendChild(resContainer);
            } 
            else if (apiResultName) {
                const notFoundSpan = document.createElement('span');
                notFoundSpan.style.color = '#999';
                notFoundSpan.style.fontSize = '11px';
                notFoundSpan.style.cursor = 'help';
                notFoundSpan.style.borderBottom = '1px dotted #ccc'; 
                notFoundSpan.innerText = 'IF DB match not found';
                notFoundSpan.title = `API Result: ${apiResultName}\n(Database에 해당 저널의 IF 정보가 없습니다)`;
                
                resContainer.appendChild(notFoundSpan);
                infoRow.appendChild(resContainer);
            }
        });
    } catch (err) {}
}

function extractPaperTitle() {
    if (!chrome.runtime?.id) return;
    let info = { title: null };
    const getMeta = (keys) => {
        for (let key of keys) {
            const el = document.querySelector(`meta[name="${key}"], meta[property="${key}"]`);
            if (el && el.getAttribute('content')) return el.getAttribute('content').trim();
        }
        return null;
    };
    info.title = getMeta(['citation_title', 'dc.title', 'og:title']);
    if (!info.title) {
        const gsTitle = document.querySelector('#gsc_oci_title');
        if (gsTitle) info.title = gsTitle.innerText.trim();
        else {
            const h1 = document.querySelector('h1');
            if (h1) info.title = h1.innerText.trim();
        }
    }
    if (info.title) {
        const cleanTitle = info.title.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, "").replace(/\s+/g, " ").trim();
        try {
            chrome.runtime.sendMessage({ type: 'PAPER_TITLE_EXTRACTED', title: cleanTitle });
        } catch (e) {}
    }
}

injectIF();
extractPaperTitle();

let timeout = null;
const observer = new MutationObserver(() => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
        injectIF();
        extractPaperTitle();
    }, 200);
});
observer.observe(document.body, { childList: true, subtree: true });
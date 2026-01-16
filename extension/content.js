/**
 * [Scholar IF & Renamer] 통합 컨텐츠 스크립트 (최종 배포 버전)
 * - UI: 모든 IF는 빨간 글씨로 표시
 * - Q1: 상위 % 계산하여 반짝이는 금색 그라데이션 뱃지 표시 (검은색 글씨)
 * - Q2-Q4: 표시 안함
 * - 지원: 일반 검색 결과 페이지 + 구글 스칼라 개인 프로필 페이지 대응
 */

const apiCache = new Map();

// 1. 학술지 이름 정규화 함수
function normalizeName(name) {
    if (!name) return "";
    return name.toUpperCase()
        .replace(/&/g, "AND")
        .replace(/\bTHE\b|\bOF\b|\bAND\b|\bFOR\b/g, "")
        .replace(/[\u2026]|\.{3}/g, "")
        .replace(/[^A-Z0-9]/g, "")
        .trim();
}

// 2. CrossRef API를 통해 정식 저널명 후보들 가져오기
async function fetchFullJournalNames(paperTitle) {
    if (!paperTitle) return [];
    if (apiCache.has(paperTitle)) return apiCache.get(paperTitle);

    try {
        const url = `https://api.crossref.org/works?query.title=${encodeURIComponent(paperTitle)}&rows=5`;
        const response = await fetch(url, { cache: "force-cache" });
        const data = await response.json();
        
        if (data.status === "ok" && data.message.items.length > 0) {
            const names = [...new Set(data.message.items
                .map(item => item['container-title']?.[0])
                .filter(name => !!name))];
            
            apiCache.set(paperTitle, names);
            return names;
        }
    } catch (err) {
        return [];
    }
    return [];
}

// [기능 1] Impact Factor 표시 로직
async function injectIF() {
    try {
        const response = await fetch(chrome.runtime.getURL('data.json'));
        const ifData = await response.json();
        
        const normalizedDB = {};
        const dbKeys = []; 
        for (const key in ifData) {
            const normKey = normalizeName(key);
            normalizedDB[normKey] = { ...ifData[key], originalName: key };
            dbKeys.push(normKey);
        }

        // 구글 스칼라 검색 결과(.gs_r) 및 프로필 페이지 행(.gsc_a_tr) 모두 선택
        const rows = document.querySelectorAll('.gs_r.gs_or.gs_scl, .gsc_a_tr'); 
        
        rows.forEach(async (row) => {
            let infoRow, titleNode, paperTitle, journalCandidate, isTruncated = false;

            // 이미 처리된 행은 건너뜀
            if (row.getAttribute('data-if-processed') === 'true') return;
            if (row.querySelector('.scholar-if-display')) return;

            // [구글 스칼라 검색 결과 페이지 대응]
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
            // [구글 스칼라 개인 프로필 페이지 대응]
            else if (row.classList.contains('gsc_a_tr')) {
                const infoDivs = row.querySelectorAll('.gsc_a_t .gs_gray');
                if (infoDivs.length < 2) return;
                
                infoRow = infoDivs[1]; // 저널명과 연도가 적힌 행
                titleNode = row.querySelector('.gsc_a_at');
                paperTitle = titleNode ? titleNode.innerText : "";
                
                // 프로필 페이지는 보통 "Journal Name, Year" 혹은 "Journal Name Vol (Issue)..." 형식
                journalCandidate = infoRow.innerText.split(',')[0].trim();
                isTruncated = infoRow.innerText.includes('…') || infoRow.innerText.includes('...');
            }

            if (!journalCandidate || !infoRow) return;
            row.setAttribute('data-if-processed', 'true');

            let matches = [];
            const normalizedJournal = normalizeName(journalCandidate);

            const tryMatch = (normName) => {
                if (!normName || normName.length < 3) return null;
                if (normalizedDB[normName]) return normalizedDB[normName];
                const foundKey = dbKeys.find(key => 
                    (key.length > 10 && (key.includes(normName) || normName.includes(key)))
                );
                return foundKey ? normalizedDB[foundKey] : null;
            };

            // 1. 동기 매칭
            if (!isTruncated) {
                const syncMatch = tryMatch(normalizedJournal);
                if (syncMatch) matches.push(syncMatch);
            }

            // 2. 비동기 API 어시스트
            if (matches.length === 0 && paperTitle) {
                const apiJournalNames = await fetchFullJournalNames(paperTitle);
                if (apiJournalNames && apiJournalNames.length > 0) {
                    for (const name of apiJournalNames) {
                        const match = tryMatch(normalizeName(name));
                        if (match) {
                            if (!matches.some(m => m.originalName === match.originalName)) {
                                matches.push(match);
                                break;
                            }
                        }
                    }
                }
                
                // 3. 접두사 매칭
                if (matches.length === 0 && normalizedJournal.length > 3) {
                    const matchedKeys = dbKeys.filter(key => key.startsWith(normalizedJournal));
                    if (matchedKeys.length > 0) {
                        matches.push(normalizedDB[matchedKeys[0]]);
                    }
                }
            }

            // UI 렌더링
            if (matches.length >= 1) {
                const m = matches[0];
                const resContainer = document.createElement('span');
                resContainer.className = 'scholar-if-display';
                resContainer.style.marginLeft = '8px';
                resContainer.style.display = 'inline-flex';
                resContainer.style.alignItems = 'center';

                // 1. IF 표시 (빨간 글씨)
                const ifText = document.createElement('span');
                ifText.style.color = '#d93025';
                ifText.style.fontWeight = 'bold';
                ifText.style.fontSize = '12px';
                ifText.innerText = `IF ${m.if}`;
                ifText.title = `Matched: ${m.originalName}`;
                resContainer.appendChild(ifText);

                // 2. Q1인 경우 상위 % 금색 그라데이션 뱃지
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
                        q1Badge.innerText = `TOP ${topPercent}%`;
                        q1Badge.title = `JIF Rank: ${m.rank}`;
                        resContainer.appendChild(q1Badge);
                    }
                }
                
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
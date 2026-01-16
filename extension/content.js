console.log("=== Scholar IF Extension: Precise TOP N% Version Loaded ===");

let journalData = null;

// Q1 저널을 위한 포인트 컬러 (황금색)
const Q1_COLOR = '#FFD700'; 

async function loadJournalData() {
    try {
        const url = chrome.runtime.getURL('data.json');
        const response = await fetch(url);
        journalData = await response.json();
        console.log("IF Data Loaded.");
        runInfection();
    } catch (error) {
        console.error("데이터 로드 오류:", error);
    }
}

/**
 * JIF Rank 문자열(예: "1/326")을 받아 상위 %를 계산하는 함수
 * 소수점 첫째 자리에서 올림 처리
 */
function calculateTopPercentage(rankStr) {
    if (!rankStr || !rankStr.includes('/')) return null;
    
    try {
        const [rank, total] = rankStr.split('/').map(num => parseFloat(num.trim()));
        if (isNaN(rank) || isNaN(total) || total === 0) return null;
        
        const percentage = (rank / total) * 100;
        // 소수점 첫째 자리에서 올림 (예: 0.31 -> 0.4)
        return Math.ceil(percentage * 10) / 10;
    } catch (e) {
        return null;
    }
}

function superNormalize(name) {
    if (!name) return "";
    return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function standardNormalize(name) {
    if (!name) return "";
    return name.toUpperCase()
               .replace(/:/g, '-')
               .replace(/\./g, '')
               .replace(/\s+/g, ' ')
               .trim();
}

function runInfection() {
    if (!journalData) return;
    const url = window.location.href;
    if (url.includes("/citations")) injectIFForProfilePage();
    else injectIFForSearchPage();
}

/**
 * 뱃지 생성 함수: 
 * - 모든 저널: 빨간색 IF 글씨 표시
 * - Q1 저널: 구체적인 'TOP N%' 수치 뱃지 표시
 */
function createBadgeWrapper(data) {
    const wrapper = document.createElement('span');
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '6px';
    wrapper.style.marginLeft = '8px';
    wrapper.style.verticalAlign = 'middle';

    // 1. IF 표시 (빨간색 굵은 글씨)
    const ifText = document.createElement('span');
    ifText.style.cssText = `
        color: #d93025; 
        font-weight: 800;
        font-size: 11px;
        letter-spacing: -0.2px;
    `;
    ifText.innerText = `IF ${data.if}`;
    wrapper.appendChild(ifText);

    // 2. Q1 저널에 구체적인 상위 % 뱃지 부여
    if (data.q && data.q.toUpperCase() === 'Q1') {
        const topPercent = calculateTopPercentage(data.rank);
        
        if (topPercent !== null) {
            const qBadge = document.createElement('span');
            qBadge.style.cssText = `
                display: inline-block;
                padding: 1px 6px;
                border-radius: 4px;
                background-color: ${Q1_COLOR};
                color: #000000;
                font-size: 9px;
                font-weight: 900;
                line-height: 1.3;
                box-shadow: 0px 1px 3px rgba(0,0,0,0.2);
                border: 1px solid rgba(0,0,0,0.05);
                text-transform: uppercase;
            `;
            
            // "TOP 0.4%" 와 같은 형식으로 표시
            qBadge.innerText = `TOP ${topPercent}%`;
            qBadge.title = `분야 내 순위: ${data.rank} (Q1 등급)`;
            
            wrapper.appendChild(qBadge);
        }
    }

    return wrapper;
}

function findJournalMatch(rawName) {
    if (!rawName) return null;
    let norm = standardNormalize(rawName);
    if (journalData[norm]) return journalData[norm];
    
    let dashNorm = norm.replace(/\s*-\s*/g, '-');
    if (journalData[dashNorm]) return journalData[dashNorm];

    const targetSuper = superNormalize(rawName);
    for (let key in journalData) {
        if (superNormalize(key) === targetSuper) {
            return journalData[key];
        }
    }
    return null;
}

function injectIFForProfilePage() {
    const rows = document.querySelectorAll('.gsc_a_tr');
    rows.forEach(row => {
        if (row.dataset.ifInjected) return;
        const journalTitleElement = row.querySelector('.gsc_a_t .gs_gray:last-of-type');
        if (!journalTitleElement) return;

        const fullText = journalTitleElement.innerText;
        let journalName = fullText.split(',')[0].split(/\d/)[0].trim();
        const data = findJournalMatch(journalName);

        if (data) {
            journalTitleElement.appendChild(createBadgeWrapper(data));
            row.dataset.ifInjected = "true";
        }
    });
}

function injectIFForSearchPage() {
    const results = document.querySelectorAll('.gs_r.gs_or.gs_scl');
    results.forEach(result => {
        if (result.dataset.ifInjected) return;
        const metaInfo = result.querySelector('.gs_a');
        if (!metaInfo) return;

        const parts = metaInfo.innerText.split('-');
        if (parts.length < 2) return;

        let journalPart = parts[1].split(',')[0].trim();
        const data = findJournalMatch(journalPart);

        if (data) {
            metaInfo.appendChild(createBadgeWrapper(data));
            result.dataset.ifInjected = "true";
        }
    });
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    loadJournalData();
} else {
    window.addEventListener('load', loadJournalData);
}

const observer = new MutationObserver(() => { if (journalData) runInfection(); });
observer.observe(document.body, { childList: true, subtree: true });
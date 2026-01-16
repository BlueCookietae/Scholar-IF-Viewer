import pandas as pd
import json
import os

# ==========================================
# 파일명을 확인해 주세요
# ==========================================
INPUT_FILE = 'JCRImpactFactors2025.xlsx' 
# ==========================================

def convert_to_json(filepath):
    ext = os.path.splitext(filepath)[-1].lower()
    df = None

    try:
        if ext == '.xlsx':
            df = pd.read_excel(filepath)
        elif ext == '.csv':
            encodings = ['utf-8-sig', 'utf-8', 'cp949', 'latin1']
            for enc in encodings:
                try:
                    df = pd.read_csv(filepath, encoding=enc)
                    break
                except: continue
    except Exception as e:
        print(f"파일 읽기 오류: {e}")
        return

    if df is None: return

    # 컬럼명 정리
    df.columns = [c.strip() for c in df.columns]
    
    if_dict = {}

    for _, row in df.iterrows():
        if_val = str(row.get('JIF 2024', ''))
        if if_val.lower() in ['nan', 'n/a', '', 'none']: continue

        # 저장할 데이터 객체 생성
        entry = {
            "if": if_val,
            "q": str(row.get('JIF Quartile', '')).strip(),
            "rank": str(row.get('JIF Rank', '')).strip()
        }

        # 1. 정식 저널명
        full_name = str(row.get('Journal Name', '')).upper().strip()
        if full_name: if_dict[full_name] = entry

        # 2. 약어 저널명
        abbr_name = str(row.get('Abbreviated Journal', '')).upper().replace('.', '').strip()
        if abbr_name and abbr_name != 'NAN': if_dict[abbr_name] = entry

    with open('data.json', 'w', encoding='utf-8') as f:
        json.dump(if_dict, f, ensure_ascii=False, indent=2)

    print(f"업그레이드 완료! {len(if_dict)}개의 상세 데이터가 생성되었습니다.")

if __name__ == "__main__":
    convert_to_json(INPUT_FILE)
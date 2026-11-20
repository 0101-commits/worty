#!/usr/bin/env bash
# kaggle-draw.yml(auto · collect)이 끝난 커널 결과를 거둔다: 내려받기 → 검사·올리기 → 장부 되올림.
# 인자 = 커널 상태(complete | error). 실패(커널 오류 · 결과 없음 · 거두기 오류)면 맡김 목록을 비우고(그 단어는 다음에 다시 뽑힘)
# exit 1 → 실행이 실패로 끝나 alert 작업이 디스코드로 한 줄. 목록을 비워서 같은 실패로 하루 여러 번 알리지 않는다.
set -u
export MSYS_NO_PATHCONV=1
state="${1:-complete}"
mkdir -p kaggle/result
kaggle kernels output "${KAGGLE_USERNAME}/worty-draw" -p kaggle/result || true
ls -R kaggle/result | head -80
echo "---- 커널 로그 끝 ----"
for f in kaggle/result/*.log; do [ -f "$f" ] && tail -c 7000 "$f"; done
drop() {
  echo "::error::$1 — 맡김 목록 비움"
  node scripts/kaggle.mjs drop && bash scripts/kaggle-commit.sh '맡김 목록 비움(거두기 실패)'
  exit 1
}
[ "$state" = complete ] || drop '커널 실패'
node scripts/kaggle.mjs collect kaggle/result || drop '거두기 실패'
bash scripts/kaggle-commit.sh '장부 갱신'

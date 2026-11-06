#!/usr/bin/env bash
# finish-all.sh — satu kali jalan: sebar top-up (4 relay) -> isi 4.004 tiket -> verify.
# Jalankan detached dari VPS:
#   cd /home/ubuntu/tzer0-bot && setsid nohup bash scripts/finish-all.sh > logs/finish-all.log 2>&1 < /dev/null &
set -u
cd /home/ubuntu/tzer0-bot
mkdir -p logs
echo "[chain] START $(date -Is)"

# 1) sebar top-up: 4 relay paralel (pass 1)
for n in 0 1 2 3; do
  ( node scripts/distribute.js --relay "$n" --run --min-delay 6 --max-delay 25 >> "logs/distribute_${n}.log" 2>&1 ) &
done
wait
echo "[chain] distribute pass1 selesai $(date -Is)"

# 2) pass 2 — beresin sisa yang gagal (kalau ada; kalau bersih cuma beberapa detik)
for n in 0 1 2 3; do
  node scripts/distribute.js --relay "$n" --run --min-delay 6 --max-delay 25 >> "logs/distribute_${n}.log" 2>&1
done
echo "[chain] distribute pass2 selesai $(date -Is)"

# 3) isi 4.004 tiket ke 14 mission (resumable, jeda 20-50 dtk, ~40 jam)
node scripts/fill-runner.js --retry-failed >> logs/fill.log 2>&1
node scripts/fill-runner.js --run >> logs/fill.log 2>&1
echo "[chain] fill selesai $(date -Is)"

# 4) sweep poin 1.000 wallet + status mission
node scripts/verify.js >> logs/verify.log 2>&1
echo "[chain] ALL DONE $(date -Is)"

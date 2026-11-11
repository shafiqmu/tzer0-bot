#!/bin/bash
# mini-chain v4 (FOKUS <500): mini-lap eksklusif (spare disikat) → lap-8 resume → conductor 9+
cd /home/ubuntu/tzer0-bot
L=logs/mini-chain.log
NOW(){ date -u +%FT%TZ; }

echo "[$(NOW)] CHAIN v4 start — mini-lap gas (spare disikat buat modal)" >> $L

# ---- fase B: mini-lap eksklusif (9 target <500) ----
node scripts/mini-lap.js --run --cycles 9 --goal 510 >> logs/mini-lap-console.log 2>&1
echo "[$(NOW)] mini exit $? — lap-8 resume" >> $L

# ---- fase C: lap-8 lanjut sampai tuntas → conductor 9+ ----
node scripts/factory-line.js --run --lap8 >> logs/line8-resume.log 2>&1
echo "[$(NOW)] lap-8 TUNTAS — conductor 9-40 nyala" >> $L
setsid nohup node scripts/lap-conductor.js --from 9 --to 40 >> logs/lap-conductor.log 2>&1 &
echo "[$(NOW)] conductor pid $!" >> $L

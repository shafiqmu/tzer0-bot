#!/bin/bash
# m268-finish: selametin misi m268 (Orbit Harbor) — trigger pas matang, tandai settled, buka kunci duitnya
cd /home/ubuntu/tzer0-bot
L=logs/mini-chain.log
NOW(){ date -u +%FT%TZ; }

echo "[$(NOW)] m268-finisher start (matang ±08:06Z)" >> $L
while true; do
  AGE=$(node -e 'try{const s=require("/home/ubuntu/tzer0-bot/analysis/factory_m268_state.json");const ts=Object.values(s.buys||{}).map(b=>b.ts||0);const l=ts.length?Math.max(...ts):0;process.stdout.write(l?String(((Date.now()-l)/60000).toFixed(0)):"-")}catch(e){process.stdout.write("-")}' 2>/dev/null)
  [ "$AGE" != "-" ] && [ "$AGE" -ge 60 ] 2>/dev/null && break
  sleep 120
done
echo "[$(NOW)] m268 MATANG — trigger..." >> $L
node scripts/factory-mission.js --run --phase trigger --plan analysis/line_m268_plan.json --state analysis/factory_m268_state.json --log logs/line_m268.log --name "Orbit Harbor" --ticker ORHA >> logs/m268-natural.log 2>&1
echo "[$(NOW)] m268 trigger exit $?" >> $L
for i in $(seq 1 60); do
  STEP=$(node -e 'try{process.stdout.write(require("/home/ubuntu/tzer0-bot/analysis/factory_m268_state.json").step||"?")}catch(e){process.stdout.write("?")}' 2>/dev/null)
  [ "$STEP" = "done" ] && break
  sleep 30
done
echo "[$(NOW)] m268 step: $STEP — tandai settled + buka excl..." >> $L
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync("analysis/line_state8.json","utf8"));
const m=j.missions.find(x=>x.n===268); if(m){m.phase="settled";m.settledTs=Date.now();}
fs.writeFileSync("analysis/line_state8.json",JSON.stringify(j,null,1));
const hold=["aged","trigger","sell","wait1","wait2","burst"];
const ex=j.missions.filter(x=>hold.includes(x.phase)).flatMap(x=>(x.wallets||[]).map(a=>a.toLowerCase()));
fs.writeFileSync("analysis/mini_c1_exclude.txt",ex.join("\n"));
console.log("state8 updated; excl c1 =",ex.length,"baris");
' >> $L 2>&1
echo "[$(NOW)] m268 SELESAI — duitnya bakal disikat mini" >> $L

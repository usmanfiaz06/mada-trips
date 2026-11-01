// Usage: node presentations/era-coffee/build-pdf.js presentations/era-coffee <screenshot-dir>
// Writes Mada-Trips-x-ERA-Coffee.pdf next to index.html and a PNG per slide into <screenshot-dir>.
const { chromium } = require('playwright');
const path=require('path');
(async()=>{
  const dir=process.argv[2], out=process.argv[3];
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:1920,height:1080}});
  await p.goto('file://'+path.resolve(dir,'index.html'),{waitUntil:'networkidle'});
  await p.evaluate(()=>document.fonts.ready);
  const fams=await p.evaluate(()=>[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight));
  console.log([...new Set(fams)].join(', '));
  const slides=await p.$$('.slide');
  for(let i=0;i<slides.length;i++) await slides[i].screenshot({path:`${out}/s${String(i+1).padStart(2,'0')}.png`});
  await p.emulateMedia({media:'print'});
  await p.pdf({path:path.resolve(dir,'Mada-Trips-x-ERA-Coffee.pdf'),width:'1920px',height:'1080px',printBackground:true,preferCSSPageSize:true});
  await b.close();
})();

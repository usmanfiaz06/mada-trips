import { commonsImage, wikipediaSummary, wikivoyageSections, wikivoyageTitle } from "../../src/lib/app/places/wiki";
(async () => {
  const f = (u: string, i?: RequestInit) => fetch(u, i);
  for (const t of [process.argv[2] ?? "Tbilisi"]) {
    const s = await wikipediaSummary(f, t); console.log(JSON.stringify(s).slice(0, 400));
    if (s && s !== "unavailable") {
      if (s.imageFile) console.log(JSON.stringify(await commonsImage(f, s.imageFile)));
      const vt = s.qid ? await wikivoyageTitle(f, s.qid) : null; console.log("voy", vt);
      if (vt && vt !== "unavailable") { const v = await wikivoyageSections(f, vt); console.log(JSON.stringify(v, null, 1)?.slice(0, 3000)); }
    }
  }
})();

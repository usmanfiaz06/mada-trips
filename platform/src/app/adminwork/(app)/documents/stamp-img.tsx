"use client";
// The company stamp, placed bottom-right of a document. If the stamp file hasn't been uploaded yet it
// simply hides itself instead of showing a broken image, so documents still look clean.
export function StampImg() {
  return (
    <img
      src="/adminwork/stamp.png"
      alt=""
      className="pointer-events-none absolute end-[8%] bottom-[14%] w-[26%] select-none"
      onError={(e) => { e.currentTarget.style.display = "none"; }}
    />
  );
}

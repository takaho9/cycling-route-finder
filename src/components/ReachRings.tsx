/** 到達レンジの同心円イラスト（選択時間に比例して 0.4〜1.0 に拡縮） */
export function ReachRings({ index, max }: { index: number; max: number }) {
  const scale = 0.4 + (0.6 * index) / Math.max(1, max)
  return (
    <div className="reach" aria-hidden="true">
      <div className="reach__rings" style={{ transform: `scale(${scale})` }}>
        <span className="reach__ring reach__ring--3" />
        <span className="reach__ring reach__ring--2" />
        <span className="reach__ring reach__ring--1" />
        <span className="reach__dot reach__dot--a">☕</span>
        <span className="reach__dot reach__dot--b">⛩️</span>
        <span className="reach__dot reach__dot--c">🌳</span>
        <span className="reach__dot reach__dot--d">🌊</span>
      </div>
      <span className="reach__bike">🚲</span>
    </div>
  )
}

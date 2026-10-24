import type { ReactNode } from 'react'
import { useMagnetic } from '../hooks/useMagnetic'
import { ArrowUpRight } from './ArrowUpRight'

const faces = [
  { hair: '#282828', skin: '#f0bd8a', shirt: '#133eff', name: '捲髮人物', style: 'curly' },
  { hair: '#654131', skin: '#f5c7ab', shirt: '#ff3c02', name: '長髮人物', style: 'long' },
  { hair: '#eeeae3', skin: '#efbd97', shirt: '#282828', name: '白髮人物', style: 'wild' },
]

function MagneticPortrait({ index, children }: { index: number; children: ReactNode }) {
  const zoneRef = useMagnetic<HTMLDivElement>()

  return <div className={`portrait-zone portrait-${index}`} ref={zoneRef}>
    <div className="portrait" data-magnetic-target>{children}</div>
  </div>
}

export function Portraits() {
  return <div className="portrait-scene" aria-label="三張等待你猜出身分的插畫人物卡">
    <span className="scene-caption">( a familiar face, a new conversation )</span>
    {faces.map((face, index) => <MagneticPortrait index={index} key={face.name}>
      <div className="portrait-art">
        <svg viewBox="0 0 180 200" role="img" aria-label={face.name}>
          <path d="M20 205 Q22 145 90 145 Q158 145 160 205" fill={face.shirt} />
          {face.style === 'long' && <path d="M42 145 Q20 38 89 28 Q160 27 141 159Z" fill={face.hair} />}
          {face.style === 'wild' && <path d="M41 106 L19 82 L38 73 L24 54 L50 51 L53 28 L76 41 L91 18 L107 37 L132 27 L132 50 L158 56 L143 77 L159 95 L137 112Z" fill={face.hair} />}
          <ellipse cx="90" cy="94" rx="44" ry="53" fill={face.skin} />
          <path d="M76 130 L76 160 Q90 174 104 160 L104 130" fill={face.skin} />
          {face.style === 'curly' && <path d="M45 89 Q20 70 41 54 Q28 32 57 32 Q65 11 87 27 Q109 9 122 31 Q151 27 144 52 Q163 75 134 91 L124 61 Q90 79 54 61Z" fill={face.hair} />}
          {face.style === 'long' && <path d="M44 86 Q37 27 92 29 Q142 29 138 87 Q111 82 99 49 Q81 82 44 86" fill={face.hair} />}
          <path d="M66 91h7m34 0h7" stroke="#38413a" strokeWidth="5" strokeLinecap="round" />
          <path d="M86 97l-3 14h9m-15 11q14 10 27-1" fill="none" stroke="#9c6552" strokeWidth="2.5" strokeLinecap="round" />
          {index === 2 && <><path d="M68 116q10-9 22-2q11-7 23 3l-23 4Z" fill={face.hair} /><g stroke="#38413a" strokeWidth="2" fill="none"><circle cx="69" cy="94" r="15" /><circle cx="111" cy="94" r="15" /><path d="M84 94h12" /></g></>}
        </svg>
      </div>
      <span className="portrait-question"><span>0{index + 1} / GUESS WHO</span><b><ArrowUpRight /></b></span>
    </MagneticPortrait>)}
    <span className="scene-sticker" aria-hidden="true">?</span>
  </div>
}

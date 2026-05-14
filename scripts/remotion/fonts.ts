import { continueRender, delayRender, staticFile } from 'remotion'

type FontDefinition = {
  family: string
  fileName: string
  weight?: number | string
  style?: string
}

const fontDefinitions: FontDefinition[] = [
  { family: 'Battery Park', fileName: 'BatteryPark.ttf' },
  { family: 'Battery Park', fileName: 'BatteryPark.otf' },
]

let installed = false

export function installCustomFonts(): void {
  if (installed) return
  installed = true
  const handle = delayRender('loading custom fonts')
  ;(async () => {
    if (typeof document === 'undefined') {
      continueRender(handle)
      return
    }
    const styleEl = document.createElement('style')
    const declarations = fontDefinitions
      .map(({ family, fileName, weight = 'normal', style = 'normal' }) => {
        const url = staticFile(fileName)
        return `@font-face {
          font-family: "${family}";
          src: url("${url}") format("truetype"), url("${url}") format("opentype");
          font-weight: ${weight};
          font-style: ${style};
          font-display: swap;
        }`
      })
      .join('\n')
    styleEl.textContent = declarations
    document.head.appendChild(styleEl)
    continueRender(handle)
  })()
}

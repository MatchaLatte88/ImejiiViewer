/**
 * Export-Pakete fuer die gaengigen Zielplattformen.
 * pngs: einzelne Bilddateien, ico: Groessen innerhalb einer .ico-Datei,
 * text: zusaetzliche Textdateien (Funktion erhaelt den Basisnamen).
 */
export const EXPORT_PRESETS = [
  {
    id: 'favicon',
    name: 'Favicon bundle',
    description: 'favicon.ico, PNGs, apple-touch-icon and web manifest for websites.',
    pngs: [
      { size: 16, name: 'favicon-16x16.png' },
      { size: 32, name: 'favicon-32x32.png' },
      { size: 48, name: 'favicon-48x48.png' },
      { size: 180, name: 'apple-touch-icon.png' },
      { size: 192, name: 'android-chrome-192x192.png' },
      { size: 512, name: 'android-chrome-512x512.png' },
    ],
    ico: { name: 'favicon.ico', sizes: [16, 32, 48] },
    text: [
      {
        name: 'site.webmanifest',
        build: (name) =>
          JSON.stringify(
            {
              name,
              short_name: name,
              icons: [
                { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
                { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
              ],
              theme_color: '#ffffff',
              background_color: '#ffffff',
              display: 'standalone',
            },
            null,
            2,
          ),
      },
      {
        name: 'usage.html',
        build: () =>
          [
            '<!-- Add this to the <head> of your page -->',
            '<link rel="icon" href="/favicon.ico" sizes="any">',
            '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
            '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
            '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
            '<link rel="manifest" href="/site.webmanifest">',
          ].join('\n'),
      },
    ],
  },
  {
    id: 'pwa',
    name: 'PWA / web app',
    description: 'Every icon size for installable web apps.',
    pngs: [72, 96, 128, 144, 152, 192, 256, 384, 512].map((size) => ({
      size,
      name: 'icon-' + size + 'x' + size + '.png',
    })),
  },
  {
    id: 'windows',
    name: 'Windows application',
    description: 'Multi-resolution .ico for desktop applications and shortcuts.',
    pngs: [{ size: 256, name: 'app-256x256.png' }],
    ico: { name: 'app.ico', sizes: [16, 24, 32, 48, 64, 128, 256] },
  },
  {
    id: 'macos',
    name: 'macOS iconset',
    description: 'Sizes for .icns - convert the folder later with iconutil.',
    pngs: [
      { size: 16, name: 'icon_16x16.png' },
      { size: 32, name: 'icon_16x16@2x.png' },
      { size: 32, name: 'icon_32x32.png' },
      { size: 64, name: 'icon_32x32@2x.png' },
      { size: 128, name: 'icon_128x128.png' },
      { size: 256, name: 'icon_128x128@2x.png' },
      { size: 256, name: 'icon_256x256.png' },
      { size: 512, name: 'icon_256x256@2x.png' },
      { size: 512, name: 'icon_512x512.png' },
      { size: 1024, name: 'icon_512x512@2x.png' },
    ],
  },
  {
    id: 'android',
    name: 'Android (mipmap)',
    description: 'Launcher icons from mdpi to xxxhdpi.',
    pngs: [
      { size: 48, name: 'mipmap-mdpi/ic_launcher.png' },
      { size: 72, name: 'mipmap-hdpi/ic_launcher.png' },
      { size: 96, name: 'mipmap-xhdpi/ic_launcher.png' },
      { size: 144, name: 'mipmap-xxhdpi/ic_launcher.png' },
      { size: 192, name: 'mipmap-xxxhdpi/ic_launcher.png' },
      { size: 512, name: 'play-store-512.png' },
    ],
  },
  {
    id: 'ios',
    name: 'iOS app icon',
    description: 'Every edge length Xcode expects.',
    pngs: [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024].map((size) => ({
      size,
      name: 'Icon-' + size + '.png',
    })),
  },
  {
    id: 'logo-web',
    name: 'Web logo',
    description: 'Large PNGs for websites, presentations and print templates.',
    pngs: [
      { size: 256, name: 'logo-256.png' },
      { size: 512, name: 'logo-512.png' },
      { size: 1024, name: 'logo-1024.png' },
      { size: 2048, name: 'logo-2048.png' },
    ],
  },
]

/** Schnell-Groessen fuer den Einzelexport. */
export const QUICK_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]

export function getPreset(id) {
  return EXPORT_PRESETS.find((preset) => preset.id === id) || null
}

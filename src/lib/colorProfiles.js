// Compact ICC Profiles, CC0-1.0, https://github.com/saucecontrol/Compact-ICC-Profiles
// Unmodified sRGB-v4.icc and DisplayP3-v4.icc. Embedded as data, not executable code.
const srgb = 'AAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb'
const p3 = 'AAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5kwzc6zlf4VsuhS9h6V6sQYQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAiY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABzAFAAMwAAbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAACD3wAAPb////+7WFlaIAAAAAAAAEq/AACxNwAACrlYWVogAAAAAAAAKDgAABEKAADIuXBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb'
export const SRGB_PROFILE = Uint8Array.from(atob(srgb), c => c.charCodeAt(0))
export const P3_PROFILE = Uint8Array.from(atob(p3), c => c.charCodeAt(0))

// Same D50-adapted primaries as sRGB, inverse BT.709 OETF instead of sRGB TRC.
// https://www.itu.int/rec/R-REC-BT.709/en — ICC parametric curve type 3.
export const REC709_PROFILE = (() => {
  const bytes = SRGB_PROFILE.slice(), view = new DataView(bytes.buffer)
  bytes.fill(0, 84, 100) // changed profile: no stale profile-ID digest
  for (const [i, value] of [1 / 0.45, 1 / 1.099, 0.099 / 1.099, 1 / 4.5, 0.081].entries()) view.setInt32(460 + i * 4, Math.round(value * 65536))
  for (const [i, character] of [...'R709'].entries()) view.setUint16(280 + i * 2, character.charCodeAt(0))
  return bytes
})()
export function validateRGBProfile(profile) {
  if (profile.length < 132 || profile.length > 1024 * 1024) throw new Error('Invalid ICC profile size.')
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength)
  const signature = at => String.fromCharCode(...profile.subarray(at, at + 4))
  if (view.getUint32(0) > profile.length || signature(36) !== 'acsp' || signature(16) !== 'RGB ' || !['XYZ ', 'Lab '].includes(signature(20))) throw new Error('Image requires a valid RGB ICC profile.')
  const count = view.getUint32(128)
  if (count > 1000 || 132 + count * 12 > profile.length) throw new Error('Invalid ICC tag table.')
  for (let i = 0; i < count; i++) if (view.getUint32(136 + i * 12) + view.getUint32(140 + i * 12) > profile.length) throw new Error('Invalid ICC tag range.')
  return profile
}

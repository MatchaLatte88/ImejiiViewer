// A process-local lease shared by expensive first-party renderer jobs.
let owner = null
export function claimAI(name) {
  if (owner) throw new Error(owner.name + ' is still active. Wait before starting another AI operation.')
  const lease = { name }; owner = lease
  return () => { if (owner === lease) owner = null }
}

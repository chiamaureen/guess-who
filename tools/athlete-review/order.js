export function prioritizeCheckedCandidates(entries) {
  return entries.toSorted((first, second) => {
    const priority = entry => entry.imageCheck.status === 'PASS' ? 0 : entry.imageUrl || entry.sourcePage ? 1 : 2
    return priority(first) - priority(second)
  })
}

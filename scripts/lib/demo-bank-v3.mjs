import { validateV3Candidates, groupTargets } from './test-bank-v3.mjs'
import { identifyLicense } from './question-license.mjs'

export function selectDemoBank(bank, scope) {
  validateV3Candidates(bank.entries)
  if (scope.id !== 'guess-who-demo-120' || scope.targetCount !== 120 || Object.keys(scope.selectedGroups).length !== 8) throw new Error('INVALID_DEMO_SCOPE')
  const selected = Object.keys(groupTargets).flatMap(group => {
    const keys = scope.selectedGroups[group]
    if (!Array.isArray(keys) || keys.length !== 15 || new Set(keys).size !== 15) throw new Error('EXPECTED_15_PER_DEMO_GROUP')
    return keys.map(key => {
      const entry = bank.entries.find(entry => entry.identityKey === key && entry.group === group)
      if (!entry) throw new Error('DEMO_CANDIDATE_NOT_IN_ORIGINAL_GROUP')
      return structuredClone(entry)
    })
  })
  if (new Set(selected.map(entry => entry.id)).size !== 120) throw new Error('DUPLICATE_DEMO_IDENTITY')
  const selectedIds = new Set(selected.map(entry => entry.id))
  return { selected, deferred: structuredClone(bank.entries.filter(entry => !selectedIds.has(entry.id))) }
}

export function demoImageBlockers(entry) {
  if (!entry.image) return ['MISSING_IMAGE']
  if (entry.group === 'animated-characters') return ['CHARACTER_RIGHTS_CLEARANCE_REQUIRED']
  const license = identifyLicense(entry.image.license, entry.image.licenseUrl)
  return [
    ...(!license ? ['UNSUPPORTED_OR_UNVERIFIED_LICENSE'] : []),
    ...(!entry.image.author?.trim() ? ['MISSING_AUTHOR'] : []),
    ...(entry.image.restrictions ? ['ADDITIONAL_RESTRICTIONS'] : []),
  ]
}

export function summarizeDemoBank(entries) {
  return Object.keys(groupTargets).map(group => {
    const members = entries.filter(entry => entry.group === group)
    const approved = members.filter(entry => entry.approved === true && entry.review?.subject && entry.review?.image && entry.review?.rights && entry.review?.presentation && entry.technical?.status === 'PASS').length
    return { group, selected: members.length, imageCandidates: members.filter(entry => entry.image).length,
      technicalWebp: members.filter(entry => entry.technical?.status === 'PASS').length, approved,
      missingImage: members.filter(entry => !entry.image).length,
      unsupportedLicense: members.filter(entry => demoImageBlockers(entry).includes('UNSUPPORTED_OR_UNVERIFIED_LICENSE')).length,
      additionalRestrictions: members.filter(entry => demoImageBlockers(entry).includes('ADDITIONAL_RESTRICTIONS')).length,
      characterRightsPending: members.filter(entry => entry.group === 'animated-characters' && !entry.review?.rights).length,
      remainingTo15: Math.max(0,15-approved),
    }
  })
}

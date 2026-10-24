const supportedVersions = ['2.0', '2.5', '3.0', '4.0']

export function identifyLicense(name, termsUrl) {
  if (['CC0', 'CC0 1.0', 'CC0-1.0'].includes(name)) {
    if (termsUrl && !/^https:\/\/creativecommons.org\/publicdomain\/zero\/1\.0\/?$/.test(termsUrl)) return null
    return { name: 'CC0', version: '1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', shareAlike: false }
  }
  if (name === 'Public domain') return { name, version: 'not-applicable', url: termsUrl || '', shareAlike: false }
  const match = /^(CC BY(?:-SA)?) (2\.0|2\.5|3\.0|4\.0)$/.exec(name ?? '')
  if (!match || !supportedVersions.includes(match[2])) return null
  const slug = match[1] === 'CC BY-SA' ? 'by-sa' : 'by'
  if (termsUrl !== `https://creativecommons.org/licenses/${slug}/${match[2]}` && termsUrl !== `https://creativecommons.org/licenses/${slug}/${match[2]}/`) return null
  return { name: match[1], version: match[2], url: `https://creativecommons.org/licenses/${slug}/${match[2]}/`, shareAlike: slug === 'by-sa' }
}

export function validateImageRights(entry) {
  const legacy = ['Public domain', 'CC0', 'CC0 1.0', 'CC0-1.0'].includes(entry.license) && !entry.rights
  if (legacy) return
  const rights = entry.rights
  const license = identifyLicense(entry.license, rights?.licenseUrl)
  if (!license || !rights || rights.licenseName !== license.name || rights.licenseVersion !== license.version
    || rights.author !== entry.author || rights.source !== entry.source || rights.attribution !== entry.attribution
    || !rights.author?.trim() || !rights.attribution?.trim() || !rights.modifications?.trim()
    || !rights.originalNotices?.trim() || !/^https:\/\/commons\.wikimedia\.org\/w(?:iki\/File:|\/index\.php\?)/.test(rights.evidenceUrl ?? '')
    || !Number.isFinite(Date.parse(rights.checkedAt)) || rights.presentationReviewed !== true
    || rights.presentation !== 'host-and-after-reveal'
    || (license.shareAlike && rights.derivativeLicenseUrl !== license.url)) throw new Error('Rights, attribution timing or ShareAlike requires further review')
}

export function storedAttribution(entry) {
  const fields = ['author', 'source', 'attribution', 'licenseName', 'licenseVersion', 'licenseUrl', 'derivativeLicenseUrl', 'modifications', 'originalNotices', 'evidenceUrl', 'checkedAt', 'presentation', 'presentationReviewed']
  return entry.rights ? JSON.stringify({ ...Object.fromEntries(fields.filter(field => Object.hasOwn(entry.rights, field)).map(field => [field, entry.rights[field]])), format: 'guess-who-image-rights-v1' }) : entry.attribution
}

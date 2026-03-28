import * as openpgp from 'openpgp';

/**
 * Generates an OpenPGP keypair for a meet guest.
 * @param {string} name
 * @returns {Promise<{publicKey: string, fingerprint: string}>}
 */
export async function generateGuestIdentity(name) {
  const { publicKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name }],
    format: 'armored',
  });

  const parsed = await openpgp.readKey({ armoredKey: publicKey });
  const fingerprint = parsed.getFingerprint();

  return { publicKey, fingerprint };
}

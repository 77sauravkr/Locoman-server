const { OAuth2Client } = require("google-auth-library");

// Returns the verified identity behind a "Sign in with Google" credential.
function createGoogleVerifier(clientId) {
  if (!clientId) return null;
  const client = new OAuth2Client(clientId);
  return async (credential) => {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const { sub, email, email_verified: verified } = ticket.getPayload();
    if (!sub || !email || !verified) throw new Error("Unverified Google account");
    return { sub, email };
  };
}

module.exports = { createGoogleVerifier };

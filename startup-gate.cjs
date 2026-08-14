function isSteamClientReady(status) {
  return status?.success === true
    && status?.steamClientConnected === true
    && /^7656\d{13}$/.test(String(status?.activeUser?.steamId || ''));
}

module.exports = { isSteamClientReady };

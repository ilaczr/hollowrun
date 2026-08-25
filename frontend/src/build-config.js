export function shouldUploadSourceMaps(environment) {
  return environment?.SENTRY_UPLOAD_SOURCEMAPS === 'true'
    && Boolean(environment.SENTRY_AUTH_TOKEN)
    && Boolean(environment.SENTRY_ORG)
    && Boolean(environment.SENTRY_PROJECT);
}

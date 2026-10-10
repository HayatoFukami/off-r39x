// The only notice the Login page accepts: shown after a password update (SPEC-050 15.5).
// It is a fixed value and carries no secret.
export const NOTICE_PARAM = "notice";
export const PASSWORD_UPDATED_NOTICE = "password-updated";
export const LOGIN_AFTER_UPDATE_PATH = `/account/login?${NOTICE_PARAM}=${PASSWORD_UPDATED_NOTICE}`;

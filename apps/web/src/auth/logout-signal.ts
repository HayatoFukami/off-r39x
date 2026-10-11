// A Logout from a protected page ends on Home (SPEC-050 15.6). While it is in progress the page's
// own AuthGate must not redirect to Login, which would replace that navigation.

let logoutInProgress = false;

export function beginLogout(): void {
  logoutInProgress = true;
}

export function endLogout(): void {
  logoutInProgress = false;
}

export function isLogoutInProgress(): boolean {
  return logoutInProgress;
}

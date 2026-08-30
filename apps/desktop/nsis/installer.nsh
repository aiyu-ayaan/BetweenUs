# Starting BetweenUs when the installer is done, without StdUtils.
#
# electron-builder starts the app from two places and both of them call
# `StdUtils::ExecShellAsUser` on the Start Menu shortcut - once from the finish
# page's "Run BetweenUs" checkbox, once from the silent install an update
# performs. That function exists to hand a launch *down* from an elevated
# installer to the signed-in user, which it does by asking the desktop shell to
# do the ShellExecute for it. When the shell will not take that call it fails,
# and the result it fails with is popped into `$0` and dropped on the floor -
# so both paths end as "the installer finished and nothing opened".
#
# This installer is per user and never elevated (`perMachine: false`,
# `allowElevation: false` in electron-builder.yml), so there is nothing to hand
# anything down from: a plain `ExecShell` is the whole of what is needed, and it
# does not go through the shell's COM interface to get there.
#
# See development/devdocs/UPDATES.md.

# Wired in by `nsis.include` in electron-builder.yml rather than by living in
# the build resources: `build/` is gitignored, and a file only one machine has
# is a file no release is built with.
#
# The finish page, replaced rather than added to: defining this macro takes the
# whole page over, so the built-in run checkbox is gone and this is the only
# thing that starts the app after an ordinary install.
!macro customFinishPage
  Function StartAppDirectly
    ExecShell "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartAppDirectly"
  !insertmacro MUI_PAGE_FINISH
!macroend

# The silent half, which is the one an update takes. Runs after the files and
# the shortcuts are in place.
#
# electron-builder's own launch still fires after this one, and on a machine
# where it works that is two launches. The second is harmless: BetweenUs holds a
# single-instance lock, so a second copy hands the window to the first and ends
# (see `requestSingleInstanceLock` in electron/main.ts). Leaving it in place
# means an install that never reaches this file still has its old behaviour.
!macro customInstall
  ${if} ${isForceRun}
  ${andIf} ${Silent}
    ExecShell "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${endIf}
!macroend

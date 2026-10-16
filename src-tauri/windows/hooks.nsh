; Gino's additions to the Windows installer and uninstaller. Tauri includes this
; file in its NSIS script (bundle > windows > nsis > installerHooks in
; tauri.conf.json); the generated script is target\release\nsis\x64\installer.nsi.
;
; Installing: Gino 0.2 and earlier were Electron apps with their own installer,
; in %LOCALAPPDATA%\Programs\gino. Installing this version moves people off it:
; close the old Gino, uninstall it, tidy up what that leaves behind, and carry
; "Start with Windows" over. Settings and stats in %APPDATA%\Gino are never
; touched: the new Gino reads the same files.
;
; Uninstalling: keep "Start with Windows" through an upgrade, and make "Delete
; the application data" include %APPDATA%\Gino.

; Where the Electron installer registered itself. The long name is the id
; electron-builder made from com.gino.stretch.
!define GINO_ELECTRON_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\e864c687-50d9-551b-ad6e-9f978f25a4d6"
; Its own notes (install folder, shortcut name), which its uninstaller removes.
!define GINO_ELECTRON_NOTES_KEY "Software\e864c687-50d9-551b-ad6e-9f978f25a4d6"
; Where it always installed (a per-user install has no folder choice).
!define GINO_ELECTRON_DIR "$LOCALAPPDATA\Programs\gino"
; Gino's settings and stats, for both versions.
!define GINO_DATA_DIR "$APPDATA\Gino"
!define GINO_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
; Task Manager's on/off switch (Startup apps) for each Run entry.
!define GINO_STARTUP_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

Var GinoOldUninstaller   ; ...\Programs\gino\Uninstall Gino.exe
Var GinoOldDir           ; ...\Programs\gino
Var GinoStartWithWindows ; installer: 1 = switch "Start with Windows" on at the end
Var GinoUpgrading        ; uninstaller: 1 = the installer is replacing this version
Var GinoRunWasOn         ; uninstaller: 1 = "Start with Windows" was on


; ---- Installing ----

; Before any of the new files are copied.
!macro NSIS_HOOK_PREINSTALL
  StrCpy $GinoStartWithWindows 0
  !insertmacro GinoRemoveElectronVersion
  !insertmacro GinoTakeOverElectronStartup
!macroend

; After the files, registry entries and shortcuts are in place. "Start with
; Windows" is written here, last, so a cancelled or failed install never leaves
; a login entry pointing at nothing.
!macro NSIS_HOOK_POSTINSTALL
  ; The uninstall step of an upgrade leaves a note when it was on (see below).
  ReadRegDWORD $R0 HKCU "${MANUPRODUCTKEY}" "StartWithWindows"
  DeleteRegValue HKCU "${MANUPRODUCTKEY}" "StartWithWindows"
  ${If} $R0 = 1
    StrCpy $GinoStartWithWindows 1
  ${EndIf}
  ; Under the product name: the name the new Gino's autostart setting and its
  ; uninstaller use.
  ${If} $GinoStartWithWindows = 1
    WriteRegStr HKCU "${GINO_RUN_KEY}" "${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  ${EndIf}
!macroend

!macro GinoRemoveElectronVersion
  ; The old uninstall entry says where its uninstaller is:
  ;   "C:\Users\<you>\AppData\Local\Programs\gino\Uninstall Gino.exe" /currentuser
  ; Keep what's inside the quotes. No entry, nothing to do.
  StrCpy $GinoOldUninstaller ""
  StrCpy $GinoOldDir ""
  ReadRegStr $R0 HKCU "${GINO_ELECTRON_KEY}" "UninstallString"
  StrCpy $R1 $R0 1
  ${If} $R1 == "$\""
    StrCpy $R1 $R0 "" 1
    ${StrLoc} $R2 $R1 "$\"" ">"
    ${If} $R2 != ""
      StrCpy $GinoOldUninstaller $R1 $R2
      ${GetParent} $GinoOldUninstaller $GinoOldDir
    ${EndIf}
  ${EndIf}

  ; Only ever run the uninstaller the Electron installer made, where it made
  ; it. Anyone can write that registry value; anything else it names is not
  ; ours to run. (Comparisons ignore case.)
  ${If} $GinoOldDir != ""
    ${GetFileName} $GinoOldUninstaller $R1
    ${If} $GinoOldDir != "${GINO_ELECTRON_DIR}"
    ${OrIf} $R1 != "Uninstall Gino.exe"
      DetailPrint "Not removing the old Gino: its uninstall entry points somewhere unexpected ($GinoOldUninstaller)."
      StrCpy $GinoOldDir ""
    ${EndIf}
  ${EndIf}

  ${If} $GinoOldDir != ""
    ${If} ${FileExists} $GinoOldUninstaller
      ; 1. Close the old Gino if it's running. The Restart Manager finds the
      ;    processes started from its Gino.exe (only those, not the new gino.exe),
      ;    asks them to close the way Windows does at sign-out, and ends any
      ;    that are still there after its timeout.
      DetailPrint "Closing the old Gino..."
      !insertmacro RestartManager_ShutdownFile "$GinoOldDir\Gino.exe" $R0
      ${If} $R0 <> 0
        DetailPrint "Restart Manager could not close it (error $R0); its uninstaller will try."
      ${EndIf}

      ; 2. Uninstall it silently and wait. Run a copy from our temp folder, as
      ;    electron-builder does itself: with /S its uninstaller starts by
      ;    ending every process run from its install folder, so run from there
      ;    it would end itself. _?= tells the copy which folder to remove and
      ;    makes ExecWait really wait (it must come last, unquoted). It deletes
      ;    app data only when given --delete-app-data, so %APPDATA%\Gino stays.
      DetailPrint "Removing the old Gino..."
      InitPluginsDir
      StrCpy $R1 "$PLUGINSDIR\old-gino-uninstaller.exe"
      ClearErrors
      CopyFiles /SILENT "$GinoOldUninstaller" "$R1"
      ${If} ${Errors}
        StrCpy $R0 "could not copy it"
      ${Else}
        ExecWait '"$R1" /S /currentuser _?=$GinoOldDir' $R0
        ${IfThen} ${Errors} ${|} StrCpy $R0 "could not start it" ${|}
        Delete "$R1"
      ${EndIf}

      ; 3. It's gone when both its Gino.exe and its uninstall entry are. Then
      ;    clear what's left of its folder (it normally removes it itself),
      ;    shortcuts it left if they still open the old Gino.exe, and its
      ;    browser engine's files next to Gino's data.
      ReadRegStr $R2 HKCU "${GINO_ELECTRON_KEY}" "UninstallString"
      ${If} $R2 == ""
      ${AndIfNot} ${FileExists} "$GinoOldDir\Gino.exe"
        ${If} $GinoOldDir != $INSTDIR
          RMDir /r "$GinoOldDir"
        ${EndIf}
        !insertmacro GinoDeleteShortcutTo "$SMPROGRAMS\Gino.lnk" "$GinoOldDir\Gino.exe"
        !insertmacro GinoDeleteShortcutTo "$DESKTOP\Gino.lnk" "$GinoOldDir\Gino.exe"
        !insertmacro GinoDeleteElectronLeftovers
      ${Else}
        DetailPrint "The old Gino was not removed (uninstaller result: $R0)."
        MessageBox MB_ICONINFORMATION|MB_OK "The old version of Gino could not be removed. You can uninstall it from Settings > Apps." /SD IDOK
      ${EndIf}
    ${Else}
      ; Its folder is gone already: drop the dead entry from Settings > Apps,
      ; and shortcuts to the missing Gino.exe.
      DeleteRegKey HKCU "${GINO_ELECTRON_KEY}"
      DeleteRegKey HKCU "${GINO_ELECTRON_NOTES_KEY}"
      !insertmacro GinoDeleteShortcutTo "$SMPROGRAMS\Gino.lnk" "$GinoOldDir\Gino.exe"
      !insertmacro GinoDeleteShortcutTo "$DESKTOP\Gino.lnk" "$GinoOldDir\Gino.exe"
    ${EndIf}
  ${EndIf}
!macroend

; The Electron Gino's Chromium kept its caches and state in %APPDATA%\Gino,
; next to Gino's own settings.json and stats.json. The new Gino's web view keeps
; its own elsewhere, so these exact names go; everything else, and the folder
; itself, stays.
!macro GinoDeleteElectronLeftovers
  SetShellVarContext current
  RMDir /r "${GINO_DATA_DIR}\blob_storage"
  RMDir /r "${GINO_DATA_DIR}\Cache"
  RMDir /r "${GINO_DATA_DIR}\Code Cache"
  RMDir /r "${GINO_DATA_DIR}\DawnGraphiteCache"
  RMDir /r "${GINO_DATA_DIR}\DawnWebGPUCache"
  RMDir /r "${GINO_DATA_DIR}\GPUCache"
  RMDir /r "${GINO_DATA_DIR}\GPUPersistentCache"
  RMDir /r "${GINO_DATA_DIR}\GrShaderCache"
  RMDir /r "${GINO_DATA_DIR}\Local Storage"
  RMDir /r "${GINO_DATA_DIR}\Network"
  RMDir /r "${GINO_DATA_DIR}\Session Storage"
  RMDir /r "${GINO_DATA_DIR}\ShaderCache"
  RMDir /r "${GINO_DATA_DIR}\Shared Dictionary"
  Delete "${GINO_DATA_DIR}\declarative_performance_observer.db"
  Delete "${GINO_DATA_DIR}\declarative_performance_observer.db-journal"
  Delete "${GINO_DATA_DIR}\DIPS"
  Delete "${GINO_DATA_DIR}\Local State"
  Delete "${GINO_DATA_DIR}\Preferences"
!macroend

; Deletes a shortcut only if it points at the given program.
; (IsShortcutTarget comes from Tauri's utils.nsh and uses $0-$3.)
!macro GinoDeleteShortcutTo link target
  ${If} ${FileExists} "${link}"
    !insertmacro IsShortcutTarget "${link}" "${target}"
    Pop $0
    ${If} $0 = 1
      Delete "${link}"
    ${EndIf}
  ${EndIf}
!macroend

; The old Gino's "Start with Windows" is a Run value named com.gino.stretch,
; pointing at its Gino.exe (or at electron.exe when it ran from source). It
; would start nothing now, so remove it and its Task Manager switch. If it was
; on, and not switched off in Task Manager, the new Gino gets "Start with
; Windows" at the end of the install.
!macro GinoTakeOverElectronStartup
  ; (StrLoc ignores case.)
  ReadRegStr $R0 HKCU "${GINO_RUN_KEY}" "com.gino.stretch"
  ${StrLoc} $R2 $R0 "electron.exe" ">"
  ${StrLoc} $R3 $R0 "\Programs\gino\" ">"
  ${If} $R2 != ""
  ${OrIf} $R3 != ""
    !insertmacro GinoStartupSwitchedOff "com.gino.stretch" $R1
    ${If} $R1 = 0
      StrCpy $GinoStartWithWindows 1
    ${EndIf}
    DeleteRegValue HKCU "${GINO_RUN_KEY}" "com.gino.stretch"
    DeleteRegValue HKCU "${GINO_STARTUP_APPROVED_KEY}" "com.gino.stretch"
  ${EndIf}
!macroend

; Sets `out` to 1 if the Run entry `name` is switched off in Task Manager,
; else 0. Task Manager keeps a 12-byte value per entry: the first byte is 2
; when on and 3 when off (then the time it was switched off), so odd means
; off; no value means on. NSIS's registry commands can't read binary values,
; so this asks Windows directly (0x80000001 is HKEY_CURRENT_USER, 8 asks for
; binary data only).
!macro GinoStartupSwitchedOff name out
  StrCpy ${out} 0
  System::Alloc 16
  Pop $R9
  System::Call 'advapi32::RegGetValueW(p 0x80000001, w "${GINO_STARTUP_APPROVED_KEY}", w "${name}", i 8, p 0, p R9, *i 16) i .R8'
  ${If} $R8 = 0
    System::Call '*$R9(&i1 .R8)'
    IntOp ${out} $R8 & 1
  ${EndIf}
  System::Free $R9
!macroend


; ---- Uninstalling ----

; Before anything is removed.
!macro NSIS_HOOK_PREUNINSTALL
  ; Tauri's installer runs this uninstaller in place (with _?=) when it
  ; replaces this version ("uninstall before installing"). From Settings > Apps
  ; NSIS runs it as a copy in a temp folder. So: run from the install folder
  ; means an upgrade.
  StrCpy $GinoUpgrading 0
  ${If} $EXEDIR == $INSTDIR
    StrCpy $GinoUpgrading 1
  ${EndIf}
  ; Tauri removes the Run value, so note now whether it's there.
  StrCpy $GinoRunWasOn 0
  ReadRegStr $R0 HKCU "${GINO_RUN_KEY}" "${PRODUCTNAME}"
  ${If} $R0 != ""
    StrCpy $GinoRunWasOn 1
  ${EndIf}
!macroend

; After files, registry entries and shortcuts are gone. (An update, /UPDATE,
; keeps "Start with Windows" and app data anyway.)
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ${If} $GinoUpgrading = 1
      ; Leave a note for the installer, which switches it back on at its end.
      ; Written now, after Tauri may have deleted this key.
      ${If} $GinoRunWasOn = 1
        WriteRegDWORD HKCU "${MANUPRODUCTKEY}" "StartWithWindows" 1
      ${EndIf}
    ${ElseIf} $DeleteAppDataCheckboxState = 1
      ; A real uninstall with "Delete the application data" ticked. Tauri
      ; removes only the com.gino.stretch folders; Gino's settings and stats
      ; are in %APPDATA%\Gino (the Electron version's folder, kept on purpose).
      SetShellVarContext current
      RMDir /r "${GINO_DATA_DIR}"
    ${EndIf}
  ${EndIf}
!macroend

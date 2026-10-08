; TeksERP panel kurulumu — electron-builder `nsis.include` (Electron/package.json). Bekçi: scripts/test_panel_kimlik.mjs (KY*).
; Yalnız İLK kurulumun varsayılan klasörünü değiştirir: boşluksuz ve ASCII <sistem sürücüsü>\EtkiliYazilim\TeksERP.
; Kayıtta önceki kurulum (InstallLocation) varsa ya da /D verilmişse dokunmaz — güncelleme kendi klasöründe kalır.

!macro customInit
  ; initMultiUser'dan SONRA koşar ($INSTDIR şablonun varsayılanını taşır); aynı kayıt anahtarını şablonla aynı görünümde okur.
  ReadRegStr $R1 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R1 == ""
    !insertmacro GetDParameter $R1
    ${if} $R1 == ""
      StrCpy $R1 $WINDIR 2
      StrCpy $INSTDIR "$R1\EtkiliYazilim\${APP_FILENAME}"
    ${endif}
  ${endif}
!macroend

!macro customInstall
  ; Program Files dışındaki klasör C:\ kökünden kullanıcılara yazılabilir miras alır; yönetici yetkisiyle koşan
  ; güncelleme/kaldırma oradaki dosyaları çalıştırdığı için klasör kilitlenir (sahip Administrators, miras kesik,
  ; SYSTEM + Administrators tam, Users okuma/çalıştırma — iyi bilinen SID'ler, dil bağımsız).
  StrLen $R2 $PROGRAMFILES64
  StrCpy $R1 $INSTDIR $R2
  ${if} $R1 != $PROGRAMFILES64
    StrCpy $R3 0
    nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /setowner *S-1-5-32-544 /T /C /Q'
    Pop $R1
    ${if} $R1 != 0
      StrCpy $R3 $R1
    ${endif}
    nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /Q'
    Pop $R1
    ${if} $R1 != 0
      StrCpy $R3 $R1
    ${endif}
    nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\*" /reset /T /C /Q'
    Pop $R1
    ${if} $R1 != 0
      StrCpy $R3 $R1
    ${endif}
    ${if} $R3 != 0
      DetailPrint "Kurulum klasörünün izinleri kısıtlanamadı (icacls $R3): $INSTDIR"
      ${ifNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Kurulum klasörünün izinleri kısıtlanamadı:$\r$\n$INSTDIR$\r$\n$\r$\nProgram çalışır; klasörü sistem yöneticinize kontrol ettirin."
      ${endif}
    ${endif}
  ${endif}
!macroend

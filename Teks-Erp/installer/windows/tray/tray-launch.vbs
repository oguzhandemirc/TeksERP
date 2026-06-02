' TeksERP tepsi panelini KONSOL PENCERESI olmadan (gizli) baslatir.
' tray.ps1'i kendi bulundugu klasorden calistirir (kurulum yolundan bagimsiz).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\tray.ps1""", 0, False

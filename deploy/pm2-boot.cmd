@echo off
rem TeksERP - acilista pm2 surec listesini geri yukler (pm2 resurrect).
rem Gorev Zamanlayici: TeksERP-Backend-Boot, SYSTEM, sistem acilisinda (ilk-kurulum.ps1 kurar).
rem Bu dosya <kok>\pm2-boot.cmd olarak durur; kok bu dosyanin klasorudur. `pm2 startup`
rem Windows'u desteklemez, `pm2 save` listeyi yazar ama geri yukleyecek bir tetik ister.
rem PM2_HOME kur.ps1 ile AYNI olmali (dump.pm2 orada); cikti <kok>\logs\pm2-boot.log.
setlocal
set "KOK=%~dp0"
set "PM2_HOME=%KOK%pm2-home"
"%KOK%pm2\node_modules\.bin\pm2.cmd" resurrect >> "%KOK%logs\pm2-boot.log" 2>&1
exit /b %ERRORLEVEL%

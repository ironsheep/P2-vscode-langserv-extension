@echo off
setlocal enabledelayedexpansion

set SCRIPT=%~nx0
set SCRIPT_VERSION=1.1

:: Define color codes
:: DOS doesn't support color codes in the same way as bash, so we'll use a helper script (color.bat) for this
:: You can find color.bat here: https://stackoverflow.com/a/26342824/3764804
::call color.bat CYAN
::call color.bat RED
::call color.bat YELLOW
::call color.bat NC

set CYAN=''
set RED=''
set YELLOW=''
set NC=''

echo %SCRIPT%: %CYAN%Running %SCRIPT% version %SCRIPT_VERSION%...%NC%

:: Find all .vsix files
for /r %%f in (spin2*.vsix) do (
    if not "!files!"=="" (
        set "files=!files! %%f"
    ) else (
        set "files=%%f"
    )
)

:: Count the number of .vsix files
set count=0
for %%f in (%files%) do (
    set /a count+=1
)

:: Install the .vsix file if there's only one, otherwise print an error message
if %count% equ 1 (
    echo %SCRIPT%: %CYAN%Installing  %files% ...%NC%
    code --install-extension %files%
) else if %count% gtr 1 (
    echo %SCRIPT%: %YELLOW%There are multiple VSIX files:%NC%
    for %%f in (%files%) do (
        echo   - %%f
    )
    echo %SCRIPT%: %YELLOW%Please remove all but the one you want to install and run the script again.%NC%
) else (
    echo %SCRIPT%: %RED%ERROR: No VSIX files found. You might be in the wrong directory.%NC%
)

endlocal

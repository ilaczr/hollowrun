# HollowRun commands

Run all commands from:

```powershell
cd \hollowrun
```

## Install dependencies

```powershell
npm.cmd ci
npm.cmd run setup
```

## Build the installer and portable executable

```powershell
npm.cmd run build
```

Output:

```text
dist-electron\HollowRun <version>.exe
dist-electron\HollowRun Setup <version>.exe

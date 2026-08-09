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

## Build the portable executable

```powershell
npm.cmd run build
```

Output:

```text
dist-electron\HollowRun <version>.exe
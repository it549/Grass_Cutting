<#
  ย้ายเครื่อง ขั้นที่ 2 · รันบน "เครื่องใหม่" ในโฟลเดอร์โปรเจกต์ที่ clone มาแล้ว
  ต้องติดตั้งก่อน: Node.js LTS, Git, PostgreSQL (เวอร์ชันเท่ากับหรือใหม่กว่าเครื่องเดิม)
    winget install OpenJS.NodeJS.LTS Git.Git PostgreSQL.PostgreSQL.18 Cloudflare.cloudflared

  สิ่งที่สคริปต์ทำ
    1. คัดลอก .env จากโฟลเดอร์ที่ย้ายมา (ถ้ายังไม่มี) แล้วทดสอบต่อฐานข้อมูล
    2. สร้างฐานข้อมูลและ restore จาก grass_cutting.dump แล้วรัน scripts\local_postgres_schema.sql (ให้ schema ตรงกับโค้ด)
    3. เทียบจำนวนแถวกับ manifest.txt ของเครื่องเดิม
    4. แตก storage.zip (รูป โลโก้ ใบสั่งจ้าง)
    5. npm ci + npm run build
    6. รันเว็บด้วย pm2 ที่พอร์ต 3004 และตั้งให้เปิดเองตอนล็อกอินเครื่อง
    7. (ถ้าใส่ -TunnelToken) ติดตั้ง Cloudflare Tunnel เป็น service — ต้องเปิดหน้าต่างแบบ Run as administrator

  วิธีรัน:  scripts\move\import-data.cmd -From D:\move-package
  ตัวเลือก:
    -From <โฟลเดอร์>     โฟลเดอร์ที่ได้จาก export-data (ค่าเริ่มต้น .\move-package)
    -Force               ทับฐานข้อมูล/storage/.env ที่มีอยู่แล้ว (ลบของเดิมบนเครื่องนี้)
    -DbName <ชื่อ>       restore ลงฐานข้อมูลชื่ออื่นแทนชื่อใน DATABASE_URL (ใช้ทดสอบ)
    -SkipBuild           ไม่รัน npm ci / npm run build
    -SkipPm2             ไม่ตั้ง pm2 (รันเองด้วย npm run start)
    -NoAutoStart         ตั้ง pm2 แต่ไม่ให้เปิดเองตอนล็อกอินเครื่อง
    -TunnelToken <token> token ของ tunnel จาก Cloudflare One → Networks → Tunnels
#>
param(
  [string]$From = "move-package",
  [switch]$Force,
  [string]$DbName,
  [switch]$SkipBuild,
  [switch]$SkipPm2,
  [switch]$NoAutoStart,
  [string]$TunnelToken,
  [int]$Port = 3004
)
# ใช้ Continue แล้วตรวจ $LASTEXITCODE เอง (PowerShell 5.1 แปลง stderr ของโปรแกรมภายนอกเป็น error ถ้าใช้ Stop)
$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "คำเตือน: $m" -ForegroundColor Yellow }
function Fail($m) { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue; Write-Host "ผิดพลาด: $m" -ForegroundColor Red; exit 1 }

function Read-DbUrl($envFile) {
  $line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
  if (-not $line) { Fail "ไม่พบ DATABASE_URL ใน $envFile" }
  $url = ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
  $u = [System.Uri]$url
  $userInfo = $u.UserInfo.Split(':', 2)
  [pscustomobject]@{
    User = [System.Uri]::UnescapeDataString($userInfo[0])
    Pass = if ($userInfo.Count -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { "" }
    Host = $u.Host
    Port = if ($u.Port -gt 0) { $u.Port } else { 5432 }
    Db   = $u.AbsolutePath.TrimStart('/')
  }
}
function Find-PgBin {
  $exe = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_restore.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace '\D.*$', '') } -Descending | Select-Object -First 1
  if ($exe) { return Split-Path $exe.FullName }
  $c = Get-Command pg_restore -ErrorAction SilentlyContinue
  if ($c) { return Split-Path $c.Source }
  Fail "ไม่พบ PostgreSQL (pg_restore.exe) — ติดตั้งก่อน: winget install PostgreSQL.PostgreSQL.18"
}
function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "ไม่พบ $cmd — $hint" } }

# ---------- ตรวจก่อนเริ่ม (ยังไม่แก้อะไร) ----------
Step "ตรวจไฟล์และโปรแกรม"
$pkg = if ([System.IO.Path]::IsPathRooted($From)) { $From } else { Join-Path $root $From }
if (-not (Test-Path $pkg)) { Fail "ไม่พบโฟลเดอร์ $pkg (ใส่ -From <โฟลเดอร์ที่คัดลอกมาจากเครื่องเดิม>)" }
$pkg = (Resolve-Path $pkg).Path
$dump = Join-Path $pkg "grass_cutting.dump"
if (-not (Test-Path $dump)) { Fail "ไม่พบ grass_cutting.dump ใน $pkg" }
if (-not (Test-Path "package.json") -or -not (Test-Path "scripts\local_postgres_schema.sql")) { Fail "ต้องรันในโฟลเดอร์โปรเจกต์ grass-cutting (ไม่พบ package.json / scripts\local_postgres_schema.sql)" }
if (-not $SkipBuild) { Need node "ติดตั้ง Node.js: winget install OpenJS.NodeJS.LTS"; Need npm "ติดตั้ง Node.js: winget install OpenJS.NodeJS.LTS" }
$pg = Find-PgBin
Write-Host "PostgreSQL: $pg"

# .env
if (Test-Path ".env") {
  if ($Force -and (Test-Path (Join-Path $pkg ".env"))) { Copy-Item (Join-Path $pkg ".env") ".env" -Force; Write-Host "ทับ .env ด้วยไฟล์จากเครื่องเดิม" }
  else { Write-Host "ใช้ .env ที่มีอยู่แล้วในโฟลเดอร์นี้" }
} elseif (Test-Path (Join-Path $pkg ".env")) {
  Copy-Item (Join-Path $pkg ".env") ".env"; Write-Host "คัดลอก .env จากเครื่องเดิม"
} else { Fail "ไม่พบ .env ทั้งในโปรเจกต์และใน $pkg" }

$db = Read-DbUrl ".env"
$target = if ($DbName) { $DbName } else { $db.Db }
if ($target -notmatch '^[A-Za-z0-9_]+$') { Fail "ชื่อฐานข้อมูล '$target' ใช้ได้แค่ a-z 0-9 _" }
$env:PGPASSWORD = $db.Pass   # ใช้เฉพาะในหน้าต่างนี้
$env:PGOPTIONS = "-c client_min_messages=warning"
$conn = @("-h", $db.Host, "-p", $db.Port, "-U", $db.User)
$psql = Join-Path $pg "psql.exe"

$ok = & $psql @conn -d postgres -At -c "select 1" 2>&1
if ($LASTEXITCODE -ne 0) { Fail "ต่อ PostgreSQL ไม่ได้ด้วยค่าใน .env ($($db.User)@$($db.Host):$($db.Port)) — ถ้ารหัสของ user postgres บนเครื่องนี้ต่างจากเครื่องเดิม ให้แก้ DATABASE_URL ใน .env แล้วรันใหม่`n$ok" }

$exists = (& $psql @conn -d postgres -At -c "select 1 from pg_database where datname = '$target'") -eq "1"
if ($exists) {
  $nTables = [int](& $psql @conn -d $target -At -c "select count(*) from information_schema.tables where table_schema = 'public'")
  if ($nTables -gt 0 -and -not $Force) { Fail "ฐานข้อมูล '$target' มีตารางอยู่แล้ว $nTables ตาราง — ถ้าจะลบของเดิมบนเครื่องนี้แล้ว restore ใหม่ ให้รันซ้ำพร้อม -Force" }
}
$zip = Join-Path $pkg "storage.zip"
if ((Test-Path $zip) -and (Test-Path "storage") -and -not $Force) {
  if ((Get-ChildItem "storage" -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) { Fail "มีโฟลเดอร์ storage ที่มีไฟล์อยู่แล้ว — รันซ้ำพร้อม -Force ถ้าจะทับ" }
}

# ---------- ฐานข้อมูล ----------
Step "สร้างฐานข้อมูล '$target' แล้ว restore"
if ($exists) {
  & (Join-Path $pg "dropdb.exe") @conn --force $target
  if ($LASTEXITCODE -ne 0) { Fail "ลบฐานข้อมูลเดิมไม่สำเร็จ" }
}
& (Join-Path $pg "createdb.exe") @conn $target
if ($LASTEXITCODE -ne 0) { Fail "สร้างฐานข้อมูลไม่สำเร็จ" }
$out = & (Join-Path $pg "pg_restore.exe") @conn -d $target --no-owner --no-privileges $dump 2>&1
if ($LASTEXITCODE -ne 0) {
  $out | ForEach-Object { Write-Host "  $_" }
  Fail "restore ไม่สำเร็จ — ถ้าขึ้นว่า 'unsupported version' ให้ติดตั้ง PostgreSQL เวอร์ชันเท่ากับหรือใหม่กว่าเครื่องเดิม"
}

Step "อัปเดต schema ให้ตรงกับโค้ด (scripts\local_postgres_schema.sql)"
$out = & $psql @conn -d $target -q -v ON_ERROR_STOP=1 -f "scripts\local_postgres_schema.sql" 2>&1
if ($LASTEXITCODE -ne 0) { $out | ForEach-Object { Write-Host "  $_" }; Fail "รัน schema ไม่สำเร็จ" }

Step "เทียบจำนวนแถวกับเครื่องเดิม"
$manifest = Join-Path $pkg "manifest.txt"
if (Test-Path $manifest) {
  $want = @{}
  Get-Content $manifest -Encoding UTF8 | Where-Object { $_ -match '^([a-z_]+)=(\d+)$' } | ForEach-Object { $want[$Matches[1]] = [int]$Matches[2] }
  $bad = 0
  foreach ($t in ($want.Keys | Sort-Object)) {
    $n = [int](& $psql @conn -d $target -At -c "select count(*) from public.""$t""")
    $mark = if ($n -eq $want[$t]) { "ok" } else { $bad++; "ไม่ตรง (เครื่องเดิม $($want[$t]))" }
    "  {0,-16} {1,8}  {2}" -f $t, $n, $mark
  }
  if ($bad) { Fail "จำนวนแถวไม่ตรง $bad ตาราง" }
} else { Warn "ไม่พบ manifest.txt ข้ามการเทียบ" }

# ---------- ไฟล์แนบ ----------
if (Test-Path $zip) {
  Step "แตก storage.zip"
  if ($Force -and (Test-Path "storage")) { Remove-Item "storage" -Recurse -Force }
  & tar.exe -xf $zip -C $root
  if ($LASTEXITCODE -ne 0) { Fail "แตก storage.zip ไม่สำเร็จ" }
  $n = (Get-ChildItem "storage" -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-Host "  ไฟล์แนบ $n ไฟล์"
} else { Warn "ไม่มี storage.zip (เครื่องเดิมยังไม่มีไฟล์แนบ)" }
Remove-Item Env:\PGPASSWORD, Env:\PGOPTIONS -ErrorAction SilentlyContinue

# ---------- build ----------
if (-not $SkipBuild) {
  Step "ติดตั้งแพ็กเกจ (npm ci)"
  & npm ci
  if ($LASTEXITCODE -ne 0) { Fail "npm ci ไม่สำเร็จ" }
  Step "build (npm run build)"
  & npm run build
  if ($LASTEXITCODE -ne 0) { Fail "build ไม่สำเร็จ" }
}

# ---------- pm2 ----------
if (-not $SkipPm2) {
  Step "รันเว็บด้วย pm2 ที่พอร์ต $Port"
  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    & npm install -g pm2
    if ($LASTEXITCODE -ne 0) { Fail "ติดตั้ง pm2 ไม่สำเร็จ" }
  }
  & pm2 delete grass-cutting *> $null
  # เรียก next ตรงๆ (บน Windows "pm2 start npm" ใช้ไม่ได้เพราะ npm เป็น .cmd)
  & pm2 start "node_modules\next\dist\bin\next" --name grass-cutting --interpreter node --cwd "$root" -- start -p $Port
  if ($LASTEXITCODE -ne 0) { Fail "pm2 start ไม่สำเร็จ" }
  & pm2 save | Out-Null
  if (-not $NoAutoStart) {
    if (-not (Get-Command pm2-startup -ErrorAction SilentlyContinue)) { & npm install -g pm2-windows-startup | Out-Null }
    & pm2-startup install
    if ($LASTEXITCODE -ne 0) { Warn "ตั้งให้ pm2 เปิดเองตอนล็อกอินไม่สำเร็จ (เว็บยังรันอยู่ แต่รีสตาร์ทเครื่องแล้วต้อง pm2 resurrect เอง)" }
  }

  Step "ทดสอบเปิด http://localhost:$Port/login"
  $up = $false
  for ($i = 0; $i -lt 30 -and -not $up; $i++) {
    try { $r = Invoke-WebRequest "http://localhost:$Port/login" -UseBasicParsing -TimeoutSec 3; $up = $r.StatusCode -eq 200 } catch { Start-Sleep -Seconds 1 }
  }
  if ($up) { Write-Host "  เว็บพร้อมใช้งาน" -ForegroundColor Green } else { Warn "ยังเปิดหน้าเว็บไม่ได้ ดู log ด้วย: pm2 logs grass-cutting" }
}

# ---------- Cloudflare Tunnel ----------
if ($TunnelToken) {
  Step "ติดตั้ง Cloudflare Tunnel เป็น service"
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { Fail "ติดตั้ง tunnel ต้องใช้สิทธิ์ admin — ข้อมูลและเว็บย้ายเสร็จแล้ว เหลือแค่เปิด cmd แบบ Run as administrator แล้วรัน: cloudflared service install <token>" }
  Need cloudflared "ติดตั้ง: winget install Cloudflare.cloudflared"
  if (Get-Service cloudflared -ErrorAction SilentlyContinue) { Fail "มี service cloudflared อยู่แล้วบนเครื่องนี้ — ถอนก่อนด้วย: cloudflared service uninstall" }
  & cloudflared service install $TunnelToken
  if ($LASTEXITCODE -ne 0) { Fail "ติดตั้ง tunnel ไม่สำเร็จ" }
}

Write-Host "`nย้ายเสร็จแล้ว" -ForegroundColor Green
Write-Host "เหลือทำเอง:"
if (-not $TunnelToken) { Write-Host "  - ติดตั้ง tunnel: Cloudflare One → Networks → Tunnels → เลือก tunnel → คัดลอกคำสั่ง Windows (cloudflared service install <token>) รันใน cmd แบบ Run as administrator" }
Write-Host "  - ตรวจ Public Hostname → Service เป็น http://localhost:$Port"
Write-Host "  - เครื่องเดิม: ถอน tunnel (cloudflared service uninstall) และหยุดเว็บ (pm2 delete grass-cutting) ไม่อย่างนั้นผู้ใช้อาจถูกส่งไปเครื่องเก่า"
Write-Host "  - เก็บโฟลเดอร์ $pkg ไว้เป็น backup สักระยะ แล้วค่อยลบ (มีรหัสผ่านใน .env)"

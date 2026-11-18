<#
  ย้ายเครื่อง ขั้นที่ 1 · รันบน "เครื่องเดิม"
  สร้างโฟลเดอร์ move-package ที่มี
    - grass_cutting.dump   ฐานข้อมูลทั้งหมด (pg_dump แบบ custom format)
    - storage.zip          ไฟล์แนบ (รูป โลโก้ ใบสั่งจ้าง) จากโฟลเดอร์ storage\
    - .env                 ค่าตั้งค่า (รหัสฐานข้อมูล AUTH_SECRET คีย์ Claude) — ห้ามส่งในแชต/อัปขึ้นที่สาธารณะ
    - manifest.txt         จำนวนแถวแต่ละตาราง ไว้เทียบหลังย้าย
  แล้วคัดลอกทั้งโฟลเดอร์ไปเครื่องใหม่ (USB/แชร์ไฟล์) แล้วรัน scripts\move\import-data.cmd

  วิธีรัน (จากโฟลเดอร์โปรเจกต์):  scripts\move\export-data.cmd
  ตัวเลือก:
    -Out <โฟลเดอร์>   ที่เก็บผลลัพธ์ (ค่าเริ่มต้น .\move-package)
    -KeepRunning      ไม่หยุดเว็บ (pm2) ระหว่าง backup — ข้อมูลที่บันทึกหลังจากนี้จะไม่ตามไปเครื่องใหม่
#>
param(
  [string]$Out = "move-package",
  [switch]$KeepRunning
)
# ใช้ Continue แล้วตรวจ $LASTEXITCODE เอง (PowerShell 5.1 แปลง stderr ของโปรแกรมภายนอกเป็น error ถ้าใช้ Stop)
$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "ผิดพลาด: $m" -ForegroundColor Red; exit 1 }

# ---------- ค่าจาก .env ----------
function Read-DbUrl {
  if (-not (Test-Path ".env")) { Fail "ไม่พบไฟล์ .env ในโฟลเดอร์โปรเจกต์ ($root)" }
  $line = Get-Content ".env" -Encoding UTF8 | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
  if (-not $line) { Fail "ไม่พบ DATABASE_URL ใน .env" }
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
  $exe = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace '\D.*$', '') } -Descending | Select-Object -First 1
  if (-not $exe) { $c = Get-Command pg_dump -ErrorAction SilentlyContinue; if ($c) { return Split-Path $c.Source } }
  if (-not $exe) { Fail "ไม่พบ pg_dump.exe (ติดตั้ง PostgreSQL ไว้ที่ C:\Program Files\PostgreSQL\<เวอร์ชัน>\bin หรือใส่ไว้ใน PATH)" }
  Split-Path $exe.FullName
}

$db = Read-DbUrl
$pg = Find-PgBin
$env:PGPASSWORD = $db.Pass   # ใช้เฉพาะในหน้าต่างนี้ ไม่บันทึกที่ไหน
$conn = @("-h", $db.Host, "-p", $db.Port, "-U", $db.User)
Write-Host "ฐานข้อมูล: $($db.Db) @ $($db.Host):$($db.Port) (user $($db.User))"
Write-Host "PostgreSQL: $pg"

# ---------- หยุดเว็บ ----------
$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
$stopped = $false
if ($pm2 -and -not $KeepRunning) {
  $list = (& pm2 jlist 2>$null) -join ""
  if ($list -match '"name":"grass-cutting"') {
    Step "หยุดเว็บ (pm2 stop grass-cutting) กันข้อมูลเปลี่ยนระหว่าง backup"
    & pm2 stop grass-cutting | Out-Null
    $stopped = $true
  }
}

# ---------- เตรียมโฟลเดอร์ ----------
$outDir = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { [System.IO.Path]::GetFullPath((Join-Path $root $Out)) }
if (Test-Path $outDir) {
  if ((Get-ChildItem $outDir -Force | Measure-Object).Count -gt 0) { Fail "โฟลเดอร์ $outDir มีไฟล์อยู่แล้ว ลบหรือย้ายออกก่อน หรือใส่ -Out ที่อื่น" }
} else { New-Item -ItemType Directory -Path $outDir -ErrorAction Stop | Out-Null }

# ---------- ฐานข้อมูล ----------
Step "Backup ฐานข้อมูล -> grass_cutting.dump"
$dump = Join-Path $outDir "grass_cutting.dump"
& (Join-Path $pg "pg_dump.exe") @conn -Fc -f $dump $db.Db
if ($LASTEXITCODE -ne 0) { Fail "pg_dump ไม่สำเร็จ (ตรวจว่า PostgreSQL เปิดอยู่ และ DATABASE_URL ถูกต้อง)" }

Step "นับจำนวนแถวแต่ละตาราง -> manifest.txt"
$q = "select string_agg(relname || '=' || n, E'\n' order by relname) from (select c.relname, (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.' || quote_ident(c.relname), false, true, '')))[1]::text::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r') t"
$counts = & (Join-Path $pg "psql.exe") @conn -d $db.Db -At -c $q
if ($LASTEXITCODE -ne 0) { Fail "นับแถวไม่สำเร็จ" }
$pgVer = (& (Join-Path $pg "pg_dump.exe") --version)
@("สร้างเมื่อ: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "จากเครื่อง: $env:COMPUTERNAME", "เวอร์ชัน: $pgVer", "commit: $(git rev-parse --short HEAD 2>$null)", "", "[rows]") + $counts |
  Set-Content (Join-Path $outDir "manifest.txt") -Encoding UTF8

# ---------- ไฟล์แนบ ----------
Step "รวมไฟล์แนบ storage\ -> storage.zip"
if (Test-Path "storage") {
  $nFiles = (Get-ChildItem "storage" -Recurse -File | Measure-Object).Count
  & tar.exe -a -cf (Join-Path $outDir "storage.zip") storage
  if ($LASTEXITCODE -ne 0) { Fail "สร้าง storage.zip ไม่สำเร็จ" }
  Add-Content (Join-Path $outDir "manifest.txt") "", "[storage] files=$nFiles" -Encoding UTF8
} else {
  Write-Host "ไม่มีโฟลเดอร์ storage (ยังไม่มีไฟล์แนบ) ข้าม" -ForegroundColor Yellow
  Add-Content (Join-Path $outDir "manifest.txt") "", "[storage] files=0" -Encoding UTF8
}

# ---------- .env ----------
Step "คัดลอก .env"
Copy-Item ".env" (Join-Path $outDir ".env") -ErrorAction Stop

Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

Write-Host "`nเสร็จแล้ว: $outDir" -ForegroundColor Green
Get-ChildItem $outDir -Force | ForEach-Object { "  {0,-22} {1,12:N0} bytes" -f $_.Name, $_.Length }
Write-Host "`nขั้นต่อไป:"
Write-Host "  1. คัดลอกทั้งโฟลเดอร์ $Out ไปเครื่องใหม่ (มีรหัสผ่านใน .env — ห้ามส่งในแชต/อัปขึ้นที่สาธารณะ)"
Write-Host "  2. บนเครื่องใหม่: clone โปรเจกต์ แล้วรัน  scripts\move\import-data.cmd -From <โฟลเดอร์ที่คัดลอกไป>"
if ($stopped) {
  Write-Host "  * เว็บบนเครื่องนี้ถูกหยุดไว้ (pm2) เพื่อไม่ให้มีข้อมูลใหม่หลัง backup — ถ้าจะเปิดกลับ: pm2 start grass-cutting" -ForegroundColor Yellow
}

# Download Hub

Kişisel indirme yöneticisi (Electron). Link yapıştır → kuyruğa girer, ilerleme, duraklat/devam (HTTP Range), hedef klasör, indirme sonrası zip açma/kopyalama. Girişli siteler **site profilleri (plugin)** ile desteklenir.

## Çalıştırma

```
cd E:\Projects\modfetch
npm install
npm start
```
Test: `npx electron test/smoke.js`

## Nasıl çalışır

- **Giriş**: Siteler sekmesi → “Tarayıcıyı aç”. Gömülü pencerede girişi (ve varsa insan doğrulamasını) **sen** yaparsın. Çerezler profil başına kalıcı saklanır ve sonraki indirmelerde kullanılır. Download Hub şifre girmez/saklamaz, CAPTCHA’ya dokunmaz. Doğrulama duvarı çıkarsa indirme “web sayfası döndü” hatasıyla durur; siteyi açıp geç, sonra “Tekrar dene”.
- **Yakalama**: Bu pencerede indirme tıklaması veya `nxm://` linki otomatik kuyruğa eklenir.
- **Nexus Mods** (resmi yollar): Ayarlar/Siteler’de kendi API anahtarını gir (nexusmods.com → Settings → API Keys; Windows ile şifreli saklanır). Free hesap: mod sayfasında “Mod Manager Download” → `nxm://` linki yakalanır (gömülü tarayıcıdan ya da “nxm:// bağlantılarını Download Hub’e bağla” ile normal tarayıcından; bu Vortex/MO2’nin yerini alır, geri alınabilir). Premium: normal mod URL’sini yapıştırmak yeter.
- **Post-işlem**: Ayarlar → ön ayar (ör. “Witcher 3 Mods”: zip’i `F:\Steam\steamapps\common\The Witcher 3\Mods`’a aç). İndirirken “Sonrası” menüsünden seç. Şimdilik yalnızca .zip (7z/rar yok).

## Yeni site profili

Profil eklemek = `plugins/` (veya `%APPDATA%\modfetch\plugins`) içine bir dosya bırakmak, sonra Siteler → “Yeniden yükle”. Kod değişikliği gerekmez. (Pratikte: siteyi bana söyle, profili ben yazarım.)

Bildirimsel `.json` (şablon: `plugins/_example-login-site.json`):
```json
{ "id":"mysite", "name":"My Site", "match":["^https://files\\.example\\.com/item/(\\d+)"],
  "login":{"url":"https://files.example.com/login"}, "referer":true,
  "resolve":{"type":"html","pattern":"href=\"(/download/[^\"]+)\""} }
```
`resolve.type`: `direct` | `template` (`$1` = match grubu) | `html` (sayfada regex ile link bul) | `json` (`apiUrl` + `path`).

Gelişmiş `.js` (bkz. `plugins/nexusmods.js`): `{ id, name, match, login, secrets, async resolve(ctx) → { url, filename?, headers? } }`; `ctx.fetch` profilin çerez oturumunu kullanır. JS profilleri tam Node yetkisiyle çalışır; yalnızca güvendiğini kur.

## Notlar
- Sitelerin kullanım şartlarına uy; Download Hub bot doğrulamasını aşmaya çalışmaz.
- İndirilen dosya sunucu web sayfası dönerse (giriş/doğrulama) hata verir, bozuk dosya yazmaz.

## Ek özellikler
- **Tepsi + otomatik başlatma:** pencereyi kapatınca tepsiye iner; Ayarlar → “Windows açılınca başlat”.
- **Tarayıcı eklentisi** (`extension/`, Chrome/Edge): `chrome://extensions` → Geliştirici modu → Paketlenmemiş yükle. Ayarlar’daki anahtarı eklenti seçeneklerine yapıştır. Tarayıcı indirmeleri Download Hub’e gider (uygulama kapalıysa tarayıcı normal indirir). Bağlantı yalnızca 127.0.0.1:17653 ve anahtar korumalı.
- **Geçmiş ve istatistikler:** toplam/bugün/7 gün, günlük grafik, siteye göre döküm, aranabilir geçmiş, “tekrar indir”.
- Panodaki link algılama, sürükle-bırak, filtreler, tümünü duraklat/başlat, bitince bildirim.

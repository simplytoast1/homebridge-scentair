# Changelog

All notable changes to this project are documented here.

## 1.1.0

This release focuses on reliability. The plugin is now much harder to knock
over, keeps HomeKit in sync with changes made elsewhere, and recovers on its
own from common hiccups.

### Fixed

- **No more Homebridge crash from the accent light.** Changing the accent
  light color while your ScentAir cloud was unreachable could bring down the
  whole Homebridge instance (taking every plugin with it). It now fails
  gracefully.
- **Accent light picks the right color.** Choosing a color in the Home app
  could land on the wrong one (for example, asking for Blue and getting Red).
  The color you pick is now the color you get.
- **Stays working after a password change.** When your ScentAir login token
  expired or was revoked (for instance, after you changed your password), the
  plugin used to get stuck showing "No Response" until you restarted
  Homebridge. It now re-authenticates automatically.
- **Survives a slow start.** If the network was not ready when Homebridge
  started (common after a power outage), the plugin gave up and left your
  devices unresponsive. It now retries until it connects.
- **Fan on/off and speed no longer fight.** Turning the fan on and setting its
  speed at the same time could leave it at the wrong speed. Your chosen speed
  now wins.
- **Failures show up honestly.** When the cloud is unreachable, affected
  accessories now show as "No Response" in the Home app instead of failing
  quietly.

### Added

- **Live state sync.** Changes you make in the official ScentAir app (fan
  speed, backlight, accent color) now appear in HomeKit within about a minute,
  so automations and the Home app stay accurate.
- **Devices removed from your account disappear from HomeKit** instead of
  lingering as dead tiles.
- A `LICENSE` file (Apache-2.0).

### Changed

- **Leaner, safer install.** Removed an unused dependency, which also removed
  several packages that carried known security advisories. A fresh install now
  reports no known vulnerabilities in the plugin's runtime dependencies.
- Network requests now time out instead of hanging forever, so a flaky
  connection can no longer pile up stuck requests.
- Installing straight from GitHub now builds automatically.

## 1.0.5

- Added `scent`, `aroma`, and `whisper` to package keywords.

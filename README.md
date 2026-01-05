<p align="center">
  <img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# Homebridge ScentAir

[![npm](https://img.shields.io/npm/v/homebridge-scentair.svg)](https://www.npmjs.com/package/homebridge-scentair)

**Unlock the full potential of your ScentAir diffusers with HomeKit.**

Transform your home atmosphere with the `homebridge-scentair` plugin. Seamlessly integrate your ScentAir devices into Apple HomeKit, giving you precise control over fragrance intensity, lighting, and scheduling right from your iPhone, iPad, Mac, or Apple Watch.

## ✨ Features

*   **🌬️ Smart Fan Control**: Adjust fragrance intensity from 0% to 100% using a familiar fan interface.
*   **💡 Ambient Backlight**: Toggle the device's backlight on or off to match your mood.
*   **🌈 Accent Lighting**: Immerse your space in color! Control the LED accent light with RGB support, mapping HomeKit colors to ScentAir's 8 distinct color presets (Red, Orange, Yellow, Green, Aqua, Blue, Purple, White).
*   **🔄 Auto-Discovery**: Automatically finds all your ScentAir devices upon setup—no manual IP configuration needed.
*   **☁️ Cloud Connected**: Uses your ScentAir account for reliable control anywhere.

## 🚀 Getting Started

### Prerequisites

*   [Homebridge](https://homebridge.io/) installed on your server (Node.js required).
*   A ScentAir account with active devices.

### Installation

1.  **Install the plugin:**
    Search for `homebridge-scentair` in the Homebridge Config UI X plugins tab, or verify via terminal:
    ```bash
    npm install -g homebridge-scentair
    ```

2.  **Configure:**
    Enter your ScentAir email and password in the settings.

## 📱 Device Setup & Pairing

> [!IMPORTANT]
> **CRITICAL REQUIREMENT**: Your device must be visible and controllable on the **[ScentAir Connect Web Portal](https://scentconnect.com/)** to work with this plugin. Devices that only appear in the mobile app via Bluetooth or local caching are **not supported**.

### 1. Wi-Fi Provisioning
1.  Download the official **ScentAir** app.
2.  Click **"Sign into Your Account"**.
3.  On the login screen, scroll down and select **"Enterprise Wi-Fi Setup"**.
4.  Follow the steps to connect your device to your **2.4 GHz Wi-Fi** network.

### 2. Claim Device
1.  If the device is currently on your personal account, you must **release** it first within the app.
2.  **Claim** the device on [ScentConnect.com](https://scentconnect.com/).

### 3. Verify
Log in to [ScentConnect.com](https://scentconnect.com/) and ensure you can control your device (Fan Speed / Lights) from the web portal. If it works there, it will work in Homebridge.

## ⚙️ Configuration

It is highly recommended to use **Homebridge Config UI X** to configure this plugin. It provides a simple interface to enter your credentials.

### Manual Config (`config.json`)

If you prefer manual configuration, add the following to the `platforms` array in your `config.json`:

```json
{
    "platforms": [
        {
            "platform": "ScentAir",
            "email": "YOUR_EMAIL",
            "password": "YOUR_PASSWORD",
            "showBacklight": true,
            "showAccentLight": true
        }
    ]
}
```

## 🎨 Color Mapping

The plugin intelligently maps HomeKit's color wheel to ScentAir's supported presets:

| HomeKit Color | ScentAir Preset |
| :--- | :--- |
| Red | **Red** |
| Orange | **Orange** |
| Yellow | **Yellow** |
| Green | **Green** |
| Cyan/Aqua | **Aqua** |
| Blue | **Blue** |
| Purple | **Purple** |
| White/Low Saturation | **White** |

## 🤝 Support

If you encounter any issues or have feature requests, please check the [GitHub Issues](https://github.com/simplytoast1/homebridge-scentair/issues) page.

---
*Disclaimer: This plugin is an unofficial integration and is not affiliated with ScentAir.*

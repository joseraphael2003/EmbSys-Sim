// ----------------------------------------------------------------------------
// Copyright 2016-2017 ARM Ltd.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ----------------------------------------------------------------------------

// This file is a template and it's intented to be copied to the application
// Enable this configuration

#ifndef MBED_CLOUD_CLIENT_USER_CONFIG_H
#define MBED_CLOUD_CLIENT_USER_CONFIG_H

#ifdef MBED_CONF_APP_ENDPOINT_TYPE
#define MBED_CLOUD_CLIENT_ENDPOINT_TYPE         MBED_CONF_APP_ENDPOINT_TYPE
#else
#define MBED_CLOUD_CLIENT_ENDPOINT_TYPE         "default"
#endif

// Enable either TCP or UDP, but no both
#define MBED_CLOUD_CLIENT_TRANSPORT_MODE_TCP
// MBED_CLOUD_CLIENT_TRANSPORT_MODE_UDP

#define MBED_CLOUD_CLIENT_LIFETIME              3600

// Firmware-update support is OFF: this substrate has no flash to receive an
// image, and no valid substitute for it.
//
// The vendor template defines MBED_CLOUD_CLIENT_SUPPORT_UPDATE here, and the
// legacy tree built with it. Against Mbed CE it cannot be built honestly:
//   * every update storage PAL needs ARM_UC_PAL_FlashIAP_* (the block-device
//     PAL is a hybrid - arm_uc_pal_blockdevice.c calls
//     ARM_UC_PAL_FlashIAP_Initialize and wires FlashIAP's GetActiveDetails /
//     GetInstallerDetails into its own vtable - and the filesystem PAL, which
//     UpdateClient.cpp selects unless MBED_CLOUD_CLIENT_UPDATE_STORAGE says
//     otherwise, reaches the same three through pal_ext_*), and the only
//     definition of those three lives in pal-flashiap's implementation, which
//     instantiates Mbed CE's FlashIAP-class. With DEVICE_FLASH 0
//     (targets/TARGET_SIMULATOR/device.h) that class compiles to nothing, which
//     is why pal_plat_update.cpp and pal-flashiap are absent from the manifest.
//   * providing the flash seam over the block device instead would still end at
//     activation: "install this image and reboot into it" has no meaning for a
//     wasm module loaded by a web page, so even the vendor's own Activate step
//     (ARM_UC_PAL_FlashIAP_Activate signals ACTIVATE_DONE and returns) has
//     nothing real to do here, and nothing in this build could exercise a
//     downloaded image anyway - there is no Pelion cloud to fetch one from.
// So the capability is stated as absent rather than faked: with the define
// gone, ServiceClient.cpp / MbedCloudClient.cpp / UpdateClient.cpp compile
// their non-update paths, update_ui_example.cpp is dropped from the manifest,
// and the ARM_UC_* callers leave the link entirely (verified by scanning the
// peliondm artifact, not by reading the guards).
#define SN_COAP_MAX_BLOCKWISE_PAYLOAD_SIZE       1024

// Developer flags for Update feature
#if MBED_CONF_APP_DEVELOPER_MODE == 1
    #define MBED_CLOUD_DEV_UPDATE_CERT
    #define MBED_CLOUD_DEV_UPDATE_ID
#endif // MBED_CONF_APP_DEVELOPER_MODE

#endif // MBED_CLOUD_CLIENT_USER_CONFIG_H


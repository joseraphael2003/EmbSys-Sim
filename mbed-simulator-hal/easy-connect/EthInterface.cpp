#include "EthInterface.h"
#include "EthernetInterface.h"

/* CE defines this in netsocket/source/NetworkInterfaceDefaults.cpp, which the
 * component manifest (build-tools/build-libmbed.js) does not build, together
 * with the rest of the default-instance plumbing (the simulator supplies its
 * own EthInterface defaults here). The upstream
 * body is empty: bring-up is driven by the application's connect() call. */
void NetworkInterface::set_default_parameters() {
}

/* CE defines the top-level entry point in the same unbuilt file
 * (NetworkInterfaceDefaults.cpp, MBED_WEAK). Every retained network demo asks
 * for NetworkInterface::get_default_instance(), so without this anchor every
 * socket/TLS application links against an aborting stub instead of the
 * simulator's interface. */
NetworkInterface* NetworkInterface::get_default_instance() {
    return EthernetInterface::get_default_instance();
}

EthInterface* EthInterface::get_target_default_instance() {
    static EthernetInterface ethernet;
    return &ethernet;
}

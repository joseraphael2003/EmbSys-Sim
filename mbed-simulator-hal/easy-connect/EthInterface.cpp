#include "EthInterface.h"
#include "EthernetInterface.h"

/* CE defines this in netsocket/source/NetworkInterfaceDefaults.cpp, which
 * .simignore excludes together with the rest of the default-instance plumbing
 * (the simulator supplies its own EthInterface defaults here). The upstream
 * body is empty: bring-up is driven by the application's connect() call. */
void NetworkInterface::set_default_parameters() {
}

EthInterface* EthInterface::get_target_default_instance() {
    static EthernetInterface ethernet;
    return &ethernet;
}

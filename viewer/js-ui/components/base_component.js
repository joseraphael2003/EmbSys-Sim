(function(exports) {

    function BaseComponent() {

    }

    BaseComponent.prototype.createDestroyEl = function() {
        var destroy = document.createElement('span');
        destroy.classList.add('destroy');
        destroy.textContent = 'X';
        destroy.onclick = function() {
            if (confirm('Do you want to delete this component?')) {
                this.destroy();
            }
        }.bind(this);

        return destroy;
    };

    BaseComponent.prototype.pinNameForPin = function(pin) {
        // MbedJSHal.PinNames.boards is the one key whose value is not a pin
        // number (it is the per-board maps); only numeric entries are pins.
        return Object.keys(MbedJSHal.PinNames).find(function(p) {
            return typeof MbedJSHal.PinNames[p] === 'number' && MbedJSHal.PinNames[p] === pin;
        }.bind(this));
    };

    exports.BaseComponent = BaseComponent;

})(window.MbedJSUI);

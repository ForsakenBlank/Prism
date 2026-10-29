package com.yourname.spootify;

import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Settings -> Appearance -> App icon. Every icon colour is an activity-alias in the manifest with
 * its own launcher entry; switching enables the chosen one and disables the rest. Launchers can
 * take a few seconds to pick the change up.
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {
    static final String[] ICONS = {"dark", "light", "mono", "spectrum"};

    @PluginMethod
    public void set(PluginCall call) {
        String wanted = call.getString("name", "dark");
        boolean known = false;
        for (String name : ICONS) known |= name.equals(wanted);
        if (!known) {
            call.reject("No app icon called " + wanted);
            return;
        }
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        try {
            // the chosen one goes on first, so there is never a moment without a launcher entry
            pm.setComponentEnabledSetting(component(pkg, wanted),
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            for (String name : ICONS) {
                if (name.equals(wanted)) continue;
                pm.setComponentEnabledSetting(component(pkg, name),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            }
        } catch (Exception e) {
            call.reject("Could not change the app icon", e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("name", wanted);
        call.resolve(ret);
    }

    private ComponentName component(String pkg, String name) {
        String alias = "Icon" + Character.toUpperCase(name.charAt(0)) + name.substring(1);
        return new ComponentName(pkg, MainActivity.class.getPackage().getName() + "." + alias);
    }
}

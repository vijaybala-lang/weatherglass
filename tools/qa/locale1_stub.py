#!/usr/bin/python3
"""tools/qa/locale1_stub.py -- minimal org.freedesktop.locale1 owner
for the fake system bus (Fedora <=41 guests).

WHY: gnome-desktop's InputSourceManager (born into the 45-47 shell at
startup) calls GetManagedObjects on locale1 and, in that era,
dereferences the reply without checking the error -- on our fake bus
nobody owns the name, so the async error sails into an unchecked
pointer and SIGSEGVs the compositor (gdb-caught at
on_got_localed_proxy_for_getting_default_input_sources, libgnome-
desktop-4.so.2; upstream guards it from 48). A name that EXISTS with
empty managed objects makes every caller's success path parse.

dbus-python, not gjs: the gdbus-introspection constructor classes
(DBusArgInfo et al.) are a per-generation dialect minefield, while
dbus-python is the steziest API GNOME has ever shipped -- deliberately
chosen to make this stub era-indifferent like the products' cert.

Owned surface: /org/freedesktop/locale1 with ObjectManager (empty),
Properties.Get/GetAll (Keyboard only), SetXKeymap/Set as no-ops.
"""

import os
import dbus
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib

# modern dbus-python no longer auto-registers a main loop on import;
# exporting objects without one raises RuntimeError at BusName time.
dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
BUS = dbus.bus.BusConnection(os.environ['DBUS_SYSTEM_BUS_ADDRESS'])
PATH = '/org/freedesktop/locale1'
# The 45-47 InputSourceManager (a Fedora downstream feature: patch
# 0004 of fc41's gnome-desktop3 srpm, gnome-languages.c) reads the
# GENERATED proxy's property cache via sd_dbus_locale1_get_locale()
# and indexes the result with NO NULL check -- a missing LOCALE
# property is a guaranteed SIGSEGV wherever locale1 doesn't answer
# (the unresolved upstream twin of gnome-shell#7262). Property set
# below mirrors systemd's real org.freedesktop.locale1 exactly.
PROPS = {
    'LOCALE': dbus.Array(
        [dbus.String('LANG=C.UTF-8'), dbus.String('LC_ALL=')],
        signature='s'),
    'X11Layout': dbus.String('us'),
    'X11Model': dbus.String(''),
    'X11Variant': dbus.String(''),
    'X11Options': dbus.String(''),
}


# systemd's real localed introspection, property tags and all: the
# proxy validates the peer against this document BEFORE trusting the
# property cache; dbus-python's computed Introspect omits <property>
# entries entirely, leaving old-GDBusProxy caches unpopulated -> the
# very NULL accessor return the unguarded callers deref.
INTRO_XML = """<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.freedesktop.locale1">
    <property name="LOCALE" type="as" access="read"/>
    <property name="X11Layout" type="s" access="read"/>
    <property name="X11Model" type="s" access="read"/>
    <property name="X11Variant" type="s" access="read"/>
    <property name="X11Options" type="s" access="read"/>
    <method name="SetXKeymap">
      <arg name="layout" type="s" direction="in"/>
      <arg name="model" type="s" direction="in"/>
      <arg name="variant" type="s" direction="in"/>
      <arg name="options" type="s" direction="in"/>
    </method>
  </interface>
  <interface name="org.freedesktop.DBus.ObjectManager">
    <method name="GetManagedObjects">
      <arg name="objs" type="a{oa{sa{sv}}}" direction="out"/>
    </method>
  </interface>
</node>
"""


class Locale1(dbus.service.Object):
    def __init__(self):
        super().__init__(dbus.service.BusName(
            'org.freedesktop.locale1', BUS,
            do_not_queue=True, replace_existing=False), PATH)

    @dbus.service.method('org.freedesktop.DBus.Introspectable',
                         in_signature='', out_signature='s')
    def Introspect(self):
        return INTRO_XML

    @dbus.service.method('org.freedesktop.DBus.ObjectManager',
                         in_signature='', out_signature='a{oa{sa{sv}}}')
    def GetManagedObjects(self):
        return {PATH: {'org.freedesktop.locale1': dict(PROPS)}}

    @dbus.service.method('org.freedesktop.DBus.Properties',
                         in_signature='ss', out_signature='v')
    def Get(self, interface, prop):
        if prop in PROPS:
            return PROPS[prop]
        raise dbus.exceptions.DBusException(
            'org.freedesktop.DBus.Error.UnknownProperty', prop)

    @dbus.service.method('org.freedesktop.DBus.Properties',
                         in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        return dict(PROPS)

    @dbus.service.method('org.freedesktop.DBus.Properties',
                         in_signature='ssv', out_signature='')
    def Set(self, interface, prop, value):
        pass

    @dbus.service.method('org.freedesktop.locale1',
                         in_signature='ssss', out_signature='')
    def SetXKeymap(self, layout, model, variant, options):
        pass


svc = Locale1()
print('locale1-stub: own org.freedesktop.locale1, armed', flush=True)
GLib.MainLoop().run()

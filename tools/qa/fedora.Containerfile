# QA guest for certifying Weatherglass on an OLDER GNOME release.
# Build via tools/qa/run.sh (never by hand -- the script stamps the
# image with the release label it was resolved against).
#
# Everything the certify ladder needs: gnome-shell itself (tiers 2/3
# boot it headless via dbus-run-session, exactly like the host's
# shell-golden.sh / zipcheck.sh), gjs for the unit/pixel tiers, and
# pillow for shot-diff/certify-pixels.
ARG RELEASE=43
FROM quay.io/fedora/fedora:${RELEASE}

RUN dnf -y install \
      gnome-shell gjs python3 python3-pillow \
      zip unzip which procps-ng systemd dbus-daemon \
    && for f in 'font(Cantarell)' 'font(DejaVu Sans)' 'font(Noto Sans)' \
                'font(Noto Sans Arabic)' 'font(Noto Sans Hebrew)' \
                'font(Liberation Sans)' 'font(Emoji)' \
                'symbol(aerospace-symbol-fonts)'; do \
         dnf -y install "$f" || echo "qa: optional font provide $f unavailable"; \
       done \
    && dnf clean all

# the GNOME 49 shell activates org.freedesktop.portal.Desktop during
# init and aborts when nobody owns the name -- the desktop host always
# had a portal; the guest must ship one. Separate layer: keeps the
# big tier-1 layer cached when the portal set churns.
RUN dnf -y install xdg-desktop-portal xdg-desktop-portal-gnome \
    && dnf clean all

# the nested shells speak the session bus only; give them a private
# runtime dir and never touch a real one
ENV XDG_RUNTIME_DIR=/tmp/qa-runtime
RUN mkdir -p /tmp/qa-runtime && chmod 700 /tmp/qa-runtime

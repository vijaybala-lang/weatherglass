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

# EOL releases (<=41 today) live only on dl.fedoraproject.org/archive;
# the stock metalink repos are graves. Swap in the archive baseurls
# before any dnf runs. Live releases keep their normal repos.
RUN if [ "${RELEASE}" -le 41 ]; then \
      sed -i 's|^metalink=|#metalink=|g; s|^baseurl=|#baseurl=|g' /etc/yum.repos.d/fedora*.repo; \
      printf '[fedora-archive]\nname=Fedora ${RELEASE} archive\nbaseurl=https://dl.fedoraproject.org/pub/archive/fedora/linux/releases/${RELEASE}/Everything/$basearch/os/\nenabled=1\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-fedora-${RELEASE}-$basearch\n' > /etc/yum.repos.d/fedora-archive.repo; \
    fi

RUN dnf -y install \
      gnome-shell gjs python3 python3-pillow \
      zip unzip which procps-ng systemd dbus-daemon \
      xorg-x11-server-Xvfb python3-dbus \
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

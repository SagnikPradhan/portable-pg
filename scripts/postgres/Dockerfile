# Its glibc 2.34 is the oldest we support, as manylinux does: RHEL 9, Debian 12, Ubuntu 22.04 and later.
# See manylinux_2_34 in https://github.com/pypa/manylinux
FROM almalinux:9@sha256:9819dc675b67b595c2b59e42be7763fca1a8bb217fa5944e04daa22e9a64db16 AS build
ENV FLOOR_NAME=glibc FLOOR_VERSION=2.34

# gcc-toolset brings a newer compiler that still links against the system glibc. See
# https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/8/html/developing_c_and_cpp_applications_in_rhel_8/additional-toolsets-for-development_developing-applications
RUN dnf install -y -q gcc-toolset-13-gcc make git perl bison flex binutils findutils && dnf clean all
ENV PATH=/opt/rh/gcc-toolset-13/root/usr/bin:$PATH

ARG POSTGRES_TAG
ARG POSTGRES_COMMIT
ARG PGVECTOR_TAG
ARG PGVECTOR_COMMIT
ENV PREFIX=/opt/postgres

COPY build.sh /build.sh
RUN /build.sh compile

# These change with every commit, so they come after the compile to keep it cached.
ARG VERSION
ARG PLATFORM
ARG SOURCE
RUN /build.sh describe

# Leaves only the installed directory, which buildx's local exporter writes out.
# See https://docs.docker.com/build/exporters/local-tar/
FROM scratch
COPY --from=build /opt/postgres /

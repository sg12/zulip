from urllib.parse import urljoin

from django.conf import settings
from django.contrib.staticfiles.storage import staticfiles_storage

from zerver.lib.avatar_hash import (
    gravatar_hash,
    user_avatar_base_path_from_ids,
    user_avatar_content_hash,
)
from zerver.lib.thumbnail import MEDIUM_AVATAR_SIZE
from zerver.lib.upload import get_avatar_url
from zerver.lib.url_encoding import append_url_query_string
from zerver.models import UserProfile, Stream
from zerver.models.users import is_cross_realm_bot_email

STATIC_AVATARS_DIR = "images/static_avatars/"

DEFAULT_AVATAR_FILE = "images/default-avatar.png"


def avatar_url(
    user_profile: UserProfile, medium: bool = False, client_gravatar: bool = False
) -> str | None:
    return get_avatar_field(
        user_id=user_profile.id,
        realm_id=user_profile.realm_id,
        email=user_profile.delivery_email,
        avatar_source=user_profile.avatar_source,
        avatar_version=user_profile.avatar_version,
        medium=medium,
        client_gravatar=client_gravatar,
    )


def get_system_bots_avatar_file_name(email: str) -> str:
    system_bot_avatar_name_map = {
        settings.WELCOME_BOT: "welcome-bot",
        settings.NOTIFICATION_BOT: "notification-bot",
        settings.EMAIL_GATEWAY_BOT: "emailgateway",
    }
    return urljoin(STATIC_AVATARS_DIR, system_bot_avatar_name_map.get(email, "unknown"))


def get_static_avatar_url(email: str, medium: bool) -> str:
    avatar_file_name = get_system_bots_avatar_file_name(email)
    avatar_file_name += "-medium.png" if medium else ".png"

    if settings.DEBUG:
        # This find call may not be cheap, so we only do it in the
        # development environment to do an assertion.
        from django.contrib.staticfiles.finders import find

        if not find(avatar_file_name):
            raise AssertionError(f"Unknown avatar file for: {email}")
    elif settings.STATIC_ROOT and not staticfiles_storage.exists(avatar_file_name):
        # Fallback for the case where no avatar exists; this should
        # never happen in practice. This logic cannot be executed
        # while STATIC_ROOT is not defined, so the above STATIC_ROOT
        # check is important.
        return DEFAULT_AVATAR_FILE

    return staticfiles_storage.url(avatar_file_name)


def get_avatar_field(
    user_id: int,
    realm_id: int,
    email: str,
    avatar_source: str,
    avatar_version: int,
    medium: bool,
    client_gravatar: bool,
) -> str | None:
    """
    Most of the parameters to this function map to fields
    by the same name in UserProfile (avatar_source, realm_id,
    email, etc.).

    Then there are these:

        medium - This means we want a medium-sized avatar. This can
            affect the "s" parameter for gravatar avatars, or it
            can give us something like foo-medium.png for
            user-uploaded avatars.

        client_gravatar - If the client can compute their own
            gravatars, this will be set to True, and we'll avoid
            computing them on the server (mostly to save bandwidth).
    """

    # System bots have hardcoded avatars
    if is_cross_realm_bot_email(email):
        return get_static_avatar_url(email, medium)

    """
    If our client knows how to calculate gravatar hashes, we
    will return None and let the client compute the gravatar
    url.
    """
    if (
        client_gravatar
        and settings.ENABLE_GRAVATAR
        and avatar_source == UserProfile.AVATAR_FROM_GRAVATAR
    ):
        return None

    """
    If we get this far, we'll compute an avatar URL that may be
    either user-uploaded or a gravatar, and then we'll add version
    info to try to avoid stale caches.
    """
    if avatar_source == "U":
        hash_key = user_avatar_base_path_from_ids(user_id, avatar_version, realm_id)
        return get_avatar_url(hash_key, medium=medium)

    return get_gravatar_url(email=email, avatar_version=avatar_version, medium=medium)


def get_gravatar_url(email: str, avatar_version: int, medium: bool = False) -> str:
    url = _get_unversioned_gravatar_url(email, medium)
    return append_url_query_string(url, f"version={avatar_version:d}")


def _get_unversioned_gravatar_url(email: str, medium: bool) -> str:
    if settings.ENABLE_GRAVATAR:
        gravitar_query_suffix = f"&s={MEDIUM_AVATAR_SIZE}" if medium else ""
        hash_key = gravatar_hash(email)
        return f"https://secure.gravatar.com/avatar/{hash_key}?d=identicon{gravitar_query_suffix}"
    elif settings.DEFAULT_AVATAR_URI is not None:
        return settings.DEFAULT_AVATAR_URI
    else:
        return staticfiles_storage.url("images/default-avatar.png")


def absolute_avatar_url(user_profile: UserProfile) -> str:
    """
    Absolute URLs are used to simplify logic for applications that
    won't be served by browsers, such as rendering GCM notifications.
    """
    avatar = avatar_url(user_profile)
    # avatar_url can return None if client_gravatar=True, however here we use the default value of False
    assert avatar is not None
    return urljoin(user_profile.realm.url, avatar)


def is_avatar_new(ldap_avatar: bytes, user_profile: UserProfile) -> bool:
    new_avatar_hash = user_avatar_content_hash(ldap_avatar)

    if user_profile.avatar_hash and user_profile.avatar_hash == new_avatar_hash:
        # If an avatar exists and is the same as the new avatar,
        # then, no need to change the avatar.
        return False

    return True


def get_avatar_for_inaccessible_user() -> str:
    return staticfiles_storage.url("images/unknown-user-avatar.png")

from zerver.lib.avatar_hash import stream_gravatar_hash, stream_avatar_base_path_from_ids
from zerver.lib.upload import get_stream_avatar_url

def stream_avatar_url(stream : Stream,
                      medium : bool = False,
                      stream_gravatar : bool = False
) -> str | None:
    return get_stream_avatar_field(
        stream_id=stream.id,
        realm_id=stream.realm_id,
        avatar_source=stream.avatar_source,
        avatar_version=stream.avatar_version,
        medium=medium,
        stream_gravatar=stream_gravatar
    )


def get_stream_avatar_field(stream_id : int,
                            realm_id : int,
                            avatar_source : str,
                            avatar_version : int,
                            medium : bool,
                            stream_gravatar : bool
) -> str | None:

    if (
        stream_gravatar
        and settings.ENABLE_GRAVATAR
        and avatar_source == Stream.AVATAR_FROM_GRAVATAR
    ):
        return None

    if avatar_source == "U":
        hash_key = stream_avatar_base_path_from_ids(stream_id, avatar_version, realm_id)
        # Тут сделать в __init__ каком-то, смотри get_avatar_url
        return get_stream_avatar_url(hash_key, medium=medium)

    return get_stream_gravatar_url(stream_id=str(stream_id), realm_id=str(realm_id), avatar_version=avatar_version, medium=medium)


# Тут не уверен
def get_stream_gravatar_url(stream_id : str, realm_id : str, avatar_version : int, medium : bool = False) -> str:
    url = _get_unversioned_stream_gravatar_url(stream_id, realm_id, medium)
    return append_url_query_string(url, f"version={avatar_version:d}")


def _get_unversioned_stream_gravatar_url(stream_id : str, realm_id : str, medium : bool) -> str:
    if settings.ENABLE_GRAVATAR:
        gravatar_query_suffix = f"&s={MEDIUM_AVATAR_SIZE}" if medium else ""
        hash_key = stream_gravatar_hash(stream_id, realm_id)
        return f"https://secure.gravatar.com/avatar/{hash_key}?d=identicon{gravatar_query_suffix}"
    elif settings.DEFAULT_AVATAR_URI is not None:
        return settings.DEFAULT_AVATAR_URI
    else:
        return staticfiles_storage.url("images/default-avatar.png")
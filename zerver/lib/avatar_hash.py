import hashlib

from django.conf import settings

from zerver.models import UserProfile, Stream


def gravatar_hash(email: str) -> str:
    """Compute the Gravatar hash for an email address."""
    # Non-ASCII characters aren't permitted by the currently active e-mail
    # RFCs. However, the IETF has published https://tools.ietf.org/html/rfc4952,
    # outlining internationalization of email addresses, and regardless if we
    # typo an address or someone manages to give us a non-ASCII address, let's
    # not error out on it.
    return hashlib.md5(email.lower().encode()).hexdigest()


def user_avatar_hash(uid: str, version: str) -> str:
    # WARNING: If this method is changed, you may need to do a migration
    # similar to zerver/migrations/0060_move_avatars_to_be_uid_based.py .

    # The salt prevents unauthenticated clients from enumerating the
    # avatars of all users.
    user_key = uid + ":" + version + ":" + settings.AVATAR_SALT
    return hashlib.sha256(user_key.encode()).hexdigest()[:40]


def user_avatar_path(user_profile: UserProfile, future: bool = False) -> str:
    # 'future' is if this is for the current avatar version, of the next one.
    return user_avatar_base_path_from_ids(
        user_profile.id, user_profile.avatar_version + (1 if future else 0), user_profile.realm_id
    )


def user_avatar_base_path_from_ids(user_profile_id: int, version: int, realm_id: int) -> str:
    user_id_hash = user_avatar_hash(str(user_profile_id), str(version))
    return f"{realm_id}/{user_id_hash}"


def user_avatar_content_hash(ldap_avatar: bytes) -> str:
    return hashlib.sha256(ldap_avatar).hexdigest()




def stream_gravatar_hash(stream_id : str, realm_id : str) -> str:
    print("DEBUG avatar_hash.stream_gravatar_hash stream_id value and type:", stream_id, type(stream_id), '; realm_id and type', realm_id, type(realm_id))
    temp = stream_id + ":" + realm_id
    return hashlib.md5(temp.encode()).hexdigest()


def stream_avatar_hash(stream_id : str, version : str) -> str:
    
    stream_key = stream_id + ":" + version
    return hashlib.sha256(stream_key.encode()).hexdigest()[:40]


def stream_avatar_path(stream : Stream, future: bool = False) -> str:
    return stream_avatar_base_path_from_ids(
        stream.id, stream.avatar_version + (1 if future else 0), stream.realm_id
    )


def stream_avatar_base_path_from_ids(stream_id : int, version : int, realm_id : int) -> str:
    stream_id_hash = stream_avatar_hash(str(stream_id), str(version))
    return f"{realm_id}/{stream_id_hash}"

var validatorMessages={LOGINID:{isEmpty:"Please enter a username",isShort:"Username should have atleast 4 characters",isLong:"Username should have atmost 12 characters",isInvalid:"Please enter a valid username"},PASSWORD:{isEmpty:"Please enter a password",isShort:"Password should have atleast 6 characters",isLong:"Password should have atmost 12 characters",isInvalid:"Please enter a valid password"},EMAIL:{isEmpty:"Please enter an Email",isShort:"Email should have atleast 4 characters",isLong:"Email should have atmost 12 characters",isInvalid:"Please enter a valid Email"},CAPTCHA:{isEmpty:"Please enter a Captcha"}},validator={loginid:function(a,s){var e=validatorMessages.LOGINID;return a?a.length<4?e.isShort:!s&&a.length>12?e.isLong:"":e.isEmpty},password:function(a,s){var e=validatorMessages.PASSWORD;return a?a.length<6?e.isShort:!s&&a.length>12?e.isLong:"":e.isEmpty},email:function(a){var s=validatorMessages.EMAIL;return a?/^([\w-]+(?:\.[\w-]+)*)@((?:[\w-]+\.)*\w[\w-]{0,66})\.([a-z]{2,6}(?:\.[a-z]{2})?)$/i.test(a)?"":s.isInvalid:s.isEmpty},captcha:function(a){var s=validatorMessages.CAPTCHA;return a?"":s.isEmpty}};
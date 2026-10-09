/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();
	// @ts-ignore
	const { escape } = window.OrbitMarkdown;
	// @ts-ignore
	const { icon } = window.OrbitIcons;

	const KIND_ICONS = /** @type {Record<string, string>} */ ({ camera: 'camera', light: 'light', mesh: 'cube', ui: 'layout', particles: 'particles', audio: 'audio', script: 'code', empty: 'empty' });
	const CREATE = ['Cube', 'Sphere', 'Capsule', 'Cylinder', 'Plane', 'Empty'];

	/** NovaGame's logo, inlined by brand/logos/apply.mjs. */
	const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAQAElEQVR4nOR7aZBc53Xdue+93rtneraefYABMABJbAQJgqIgShQpUlTJpiJZi2N5KzuJ7SyOE+tHyqnIUlKxU5U4ZWVRWY7l2FaVJUuyZYumxE2kSIqkSIKkSCyDbQaz71vv63s35/teDwDL8fI7Aetxenq6X393P/fc2w7+P//n/V0veN/UVuf6UuMT1U19b7TiHfeL7lBzx4nUtxytbStam3XRoqpbU3GbgNtSeAp1NBAHAUR5OcorgCt8zMsX3z7m04Ajqq1A1OfPwIEfiIjv8jGPxpej5YC3AHwgAheu+Rm4iPFPcXGRVl7iSZfjoSvlNNMelryqvD2UkmcG+iJfefBpyf9t8snf9IePrWl6Lr/zmQeT3r8Y6/BkpQhcmW9hadaXnTUfxbWGlteqUpopoLpRARotSFPhNlvUqqoHKsChfJTCpfAR4d/4XMRRFfCx49u/md/4NAUP0KKgAYXzfVWfj32lLsyrzT9fqEfhgV2+j5dRgsQQ0QjiiKLL68ChkV4cHE/g2ISLwYygOBtg80X53N6Dkc8c+ZqU/t4KOLlc+8BBB5//1S53ZLkZ4NW1pl5eqGNhriFb83WUN6ooLuRRXd5EK1+B1im8T9NQeIcnd3kP1wjsKiKOIEpTR6ESpfkSfD7C5+O8zPP8FS2+lbdALVCtNUWadAjzeyNQ+ze+ikowyuEjWp3+xWcc/heht0Wp8AgSTgopN409uQHcvj+HY7fGcex2B0N7BTN/pEuNt51fvOM579s/LOtfC4Hx2cZP3x3DF38qLXi1EujkSh1TM1Usz9dkZ7EshfktLc+tobm1DZ4WUm9CmzylOZz6dFf6v/mPqjUW81yRmAgyPHdnNEBPHOhJCrJJoCPB9/D1xYpgp6TYLkE2+PsWQ8Lcz6f0PpUSGOGpAfNTKba5jG85VEaTIrhUbyOIoqYpVFa2sVlex0ZlHJvFDpyqRnHwn8tQ4fng0VeqrZ+7+1Xvj/5GBey/WvvA4Si++GAKeDLv68VFWn26ivWFkmzP7aBwdUHrK6vQco3maUBaLQpvTkpXDuij5oTGXqLWtVxmgSjjoNN1MJrxcGwsivsfTmLvwcvo6C4jkjSRHEGL5i6uKK68OqbPfisqZ5fqmG/WaPEmAr/J2wYmBqzgYRYRk2XgO671CB8es0qUP8sMo5LWiyUUzxewWdqHQmUAlVIcR087OlwMvvhcUNt4z5n4t/6aAm47p+mtjern3zPk4LkNn/HekMWZCvJzBexMrVD4GQTbW/TTqhUeDWYtCi5WeIYAY5a2srYx53Pp+hEmsqTrYTARwwdOZvATvzSLRO85SMdDUG+Cr+sMj6AlpIefx+DI5+TYxIfxpc+d1CeuLEvdr9GyLeq4bhKF9QSTEoJQzXzKowIcCcRkl6j6DIcANR6pBm3U9e3pOkrVCqq1vahWErjjJEPnOefz59J65Mh3w5xwXQGzl4u//uDJ+PDkJnSKiW5luoKd2TwKF2dQnZuD5vN090pb+IbJUPRJBmtg3N8Eqm9PZ6zvOCZNiU18GdfFoVwKH//5eST7n1FkD/Nl3Tx2iuL0UpC2EipVaOGKdLrX8NHT98j0dD92tI5qUBMqga5Ob6ONA36GVYAj7RTm2MQY8LUOk6KiwYthiZYYw1xdbrDItPj3ffDrKex/0Bn+zm/WP8M3fuq6AvY9pZ2ri/lf9ph4Liy0ZJ3CF67lkb84jcb8DFCg8Mbydbo+3R6thjWDiXkqgVfLHsZmVLqAsJwZ948w+jtjGbz3gT5kEt+gwgqKlT8XJ/WiIn2SQtxLZQ5Bz10TfXMHWLgVOjKOvu0i7pk4gitv7GDHL4FFkbdldhQruholq7a9QPhXeoA4FJiVhXFpy659HUxt9XGNVUvMPXQ/vNvS8Pta//KpAf0PD74ueauAzZniJ3o7XFmcC7DOmN+ZzqN0eRaNWQpfDN1eGyzyLV6+yfgtK7hNT4xT3lxDP2JgKs/hmoodQZQW6fW6cezQMjR6XGTmm2HKT61Aux8X9C0ozvYALzBDXukG1gYhhSxk3wEcnhf0SA9WgnWtsta7YRnl7QObYk2WVLHa5m88jyk5BCCBy1fwdj6V0DSGaTE3+S2dXg0Qi0VZLfYhlYvg/PntH+eBv2BDtjhZud9tCLamq5KfKaIytYT6tWt0e5PpKbyxPJOSNBmLxvpGAX7dXqJGGU1GZssWbKtpHsvjf0npwHjPKPqdVb73VtVrSehiXHSV/rtGdW2vil5YFp0iyJil226Yw0ThjOzDQKmEAXcASaQkQn93iSwomw0tWwMc+hgVwP/xwxyDkgBWFadTNNLnaayP+sgyTpMVNCJFqcgWrixcxNnZNcw3qpguVu+/kQM2qseaK55US1XUrm3wmqLbb9PyZQreCN3e5wEDIh3fN8JqGPdhOrL/gjAkRSL0wAgBSgJpdOPkkS6gNA6d5j0WuiFxZvNWBU4spigNI9h0BfkIpBRl+BJCVR2RDf7ODH9sXx8unMsij512DjAVxuYZNRVAPaILj3EfjVJ4gqNOF9m9nXjkkSPIDXXJ5fML+sKfnkNzpYFmqSwlijA5dwn1zD7EA+/YdQVIuTlYW6ygWShq9doMLVMQ1Opt4ZtWeBvnBuwYJRjBrfCBjcVdNGXkZ/SrK1GJOhlknRyOdgfqxCegVyaB7V4gwxBKJBhSFDbooTkpgGPuRRNK1KAh6EIDzng/Ji4G6HP7sY28mnIZcQmjIynEe3uR6hmUTG9Oh8e60DOYgZeLojUgOHA8QGOghI84Q/rKPcOoDEb1lf/8ugT1Opp01K3SPJQOt1f3DF5XgFNtRYpXtzUorsHf2A5LXaseCh/sXlSA8qcB5QjaV9v6oVOyItFJnSg9MkWY2oW9g2PI7dRppXH4azOQ6jCcJO8jReMplLlbJRslSuJnZRKCesJaWIs1pEYG0ffWBYwn9lJhWYmMZrDv1IDu3dNDRURQZbAxbcoyHWMlRifrEx0+wCf7N+W7/oxO+otYqRewdZuHjoNHNF+6QiU00GiyLLZ2WF36IzdCgPizUdwSLduEp2ri3cR40AiFNyCEwtsCpMbqfii8hJlfrVsat40R/ycYnxlE3UE9essw8rUSutY83WlkJREdllScHpBhrc2whKYykD5aPcdj1BI2/pWJDI0avGgvnHwDH/+lEyhkIrpGac9MNfHHb65jsTKPzfoiatggGN2WhvDM2UBufXgUzU+d1As7c/LKyobWl6uyJ3en/uq/+1F89Q8vYfJPnqFIdbToAjUt3wBCWvEVlZpSeOa0GrPmrtXbNT4ILa9GAbbESFiDbBa2yJ86YExLgl6QpgK64cWHEO/oQLE3jfrWBqrxHviZItzeAKmsp9JZANIZ0SGab685BRWx7Rpj8DOIN7bLGhtLyc5Lm/jqZhVv5n+A+a1zUgzWtK4FFkUKwrLnezx7zAjh6eUfzMuxqX3oHuzWVSbwViGrTvQoK4ngU79wC/5rMcDFrz2NVq0GIgyrANc6cM8/+jWtbRFY50VaPJjPPwZ16/IqzdDdTdeyexkQwizM0sM7RKmHBL0/Ka7bgYjXi2Rsn45MHJSMl5R9Rz0s5qtSMxm6vyXeYBOxfjZMOd4qTTQY6aDX07vi9EiXjQJ7OyoTpg32oglpXp3GawtrMlc4JxV/ldYr8DQVXiHggUmO5ozSgInzaxdm0VlnK9jKwjtXwdofv4xN73a8d39Ehka75K0X5qWxU2Qu7ggWW1/5j2ESbBpMX79hcYSXim9LG9zA+HioL8cAfWN5m7QY83H+IckXpfl7VtQbRZAYl9y7unXyLcHBmMpGLKHZXBpRWibRV5B0X51ym5C5DchSufuZF1JlQmQqN8lzrNE983GJZXPwZy/qe++4TxbeJC4JiF61IaYdYjnko4YYjNeiE/gN3mcrQOntBZy9tM4opYGqfJUfx+Zrz+K1vT+qH7urhUdvGcPkzDLfV78RAkYBNsObuLdabYpKoG2LM1O7odWJ6+HSOiw/NBkfs2X00nwBS532SuDRrJkRHP8HWcwQDgf9wGsmc/THZHQspZ39afR20S3TxBVMjKoHRFgM0EOskVgQSfEccSbNGBXgmcyWZju9hXuSNbTufhcefy2FOSyxKuxoUQpCNgI1pyx1p6YNv2HwjvpFwuVimYYzaMi1+at67aK0th7R/lQduc4UJim+L39FAb5JesTOxu1NlqbwpjQ5DHi6uOlpEY2zgU9SbraKhLeId6vGiOLifeju60XXaLcGyThxiadPsnzViCozAw6Gh4kMExFkh+JwuxLoiJDAcEzQHxDrZQbUy2Fanp8zPEOygMgtQvdO0RAzG+jubMrOC9/W2zO34cSR22XVPYVpZ0veWprGTGURa7KBLeKEAvJSZVzXKEODxmxZiG7qE3vFWl0HnYAmK2qqEeKZZjsHhFXAghoWSTTUYGkDN21li9HNoxEBszW6+kT6+pXSItHTi0P7eyG5LLELXYypg4mVHwKNm+o4JpgmsiyzLs9RbycP8Km0q4dpsxjb6XqFwGTndbQqTTj0pgiTZTTdYZXg9XfA5FN0syKsLiJ1YgDR1ZS0RkcZLlmkSwHGl3L44NAAat1EdOlNnK0t4LXpSczWtmStlsdWvaQlNmwN2zZ4OtDRh4NdNTRZXktrrEA0sq+NmxRgQE1Q193Yt8KbpJRKQfr7IXvH0Ht0H44eHaKV0qjE4qhWHdDD0Ue1ZWis5U3BwjIwTwbO2SO48x6GMj07SCqO8DaYX5LvvnUOq6/PYvWNSzLS2YM9AwNMeQ62Fpd0DVel//CQHD+xo0NHhiTZQ8LjIMMjfZtEFwYReZNnJJ5PDGeBE0yUOQdJdpBdy2mc3MnKJ8fHMRPdwJnNFXznzCU5t7GF1XKFnhCToyO34uihqjaXy7g6dZX0RRO7ICYsg3xCrevzJ3sKFnGCE9blPcPovfc4HvjgfrT2JLTLj8lBJ6p9TEMrzEfXCBsWiOnPrhOMrDJvVVkoY4IkIyfLt3/0hGCQerzwyiW4zzyNFx97FvcNPSgPH/xPOsoy0Mf0kRig050UWZ9fxNfffAz/5ttn5P0PHcUHHihg9OQJBJfJOSztWIZJ1mnT9brIQlqxJw0Zpvom2E3ynNF0Uw7Ob2CC9/nQ2DienF/B7z75NtYbEXzkxFH0jK7hhS+Q2dpYliDwmRlackMBBuGZjoq8ihBuaiyi0p+TwQduxyM/NaYDcU9+3uuQLTKaZ4mEJwlKLq3TzcniLKywZG8aUtOUcqYKZvJUP1HZUCDjMV+mXjgP/y//BC8++zYeuvU3Jb18RGeYA1NHyQQccjT1AFNARiW3OoZfSP8THEo/j3/7lf+Fa5un8EvBpIyODENHmRSXiP23iFF2GFOzvMFGmZCZvBoVgQ2W4v0884FB6AODkiZJ+8gXL2Do4X58bzGC06dZFWdK+PIT86gTCVrK1vQzuzjA7fjwrwXBhgevavGIZJndAPKAxgAAEABJREFUj+7Hh3/+ILq7HHzaG0KVVr/E3HhmR/SlZcgbc2zglpioCyEoBi0eZTHoGgBu2RPIQwMVjV46L/knvoOnvvk47r73f2Jn/VYssc8aTLF42OhUyfA9kTHipy4WGybNPZN7NOel5PPPfYNwOoHjJ6nUFD+h2jAImuQRfaHSEmHPICUmy02Wz0LDPM+egg1RmqVviA3ZnQMY+NoGjn3gODruLuPVL7Xw37/1LG9TZrI3uDXj7/hP/0abEWqIARWhTzABZFI6dmRYVrsXcdo5ro/x3tvNwHmWwr6woLK0Qotbtp2HYV8j7HDjzGG9bEEPDLTk/oECHpZl+eYbb+G5b/45xk/9BNZGDyJJuL9wltT6lkNW2LGpxiTr4UUi4+OEBTxNkwTpw8778Gj34/iL56/pXYe35N5/cDe7U3ppnt7ScG3voUW25oY2LrGSkK7HNi27wNI516F6lJ7RxdgbHkJiZV3yz3Tqb/3ZGRQbReaEFhsGz/CMN4WAedIkP4aA8mCSSmBkb4qodxWvBXN4qxaVamVQ1yppVmCaLmUafiu/sqppkmBnoAt6qKcp7+gq4EF3Ff6lM5h99TwW1kvY+85P4OC7Hbz8ZWCluYPvzxLJNQZYcWPaZN4oLRMZf5+Vj6knfYUfz07x4x0fwi+e/0089txRfeeHd8SZYKNU4fmIzRAjF7jG9rkWNUVc2HqqRh2b1oJlGnOdGX62CKcjg+LbZf3f3jbOLV5D05b6wHazgU34uwqgB4SQ0rcNLZMgXLrdoMTZqVbl0uoUytM8WT6JaKYPsS7C3dFOUttxZOlxXeT7D8QbOB4t6ynZlglC2ZfmZjB1+QoGmJ13ch3IspJeY9nb1ItsNLfJOSzKxsYePZTrQa0zhhoNNqI2krS1qXKy5wjJp5KcJae3MrmE4VMP8KRVSJKvGKSV1/iGCi9DhG7WSLLk0byyqa3n1uGXaoQrrBwfPQUzvfrLa5OotepGdjWWN4OZVhi47TIorZDH1hDrk9gi2BMlspc0Gx2HB8Y6rbbM0PPnyHRmUCas3T7QKwdGM3J3KqEPEzid4G27yfQKGYFaaVsXmCGHj57U+Q3BKwuQhZV1HuAcD0BfDjrU31nFdn5IJiID2BfrQEcmhbGPelJ+tMm2hGERiUu+UJDNjYSOeAROI2WWRZYf0z6/yetFvu6NbRTXN7FT3daCX6YkLfZGcYwxb0UHE8wypMyJdAOCI0Oz77KJu418OwT8sAyqGVQElrcL+CaXnV6G//eaTTXUGJtoJea0YzADngwGv1zzdXu4jq2sI+VoC+9igelxqJyNEhOOL5U6j7RQ1GfmObyYPcsgpzehxA4jyrHXOmNxnQ7IOtrIIah0YeF3XYyk2VtQmFq9qj5puGrdeC07xJVVwetEXN8jifIDD+XZlq5vtbBeDUieKspq7ahdTkToo0SiLj/DZQNFjGwZZeP64dyCfaTeBIR2CY+WndNphe1iUbHDX3NkI32Ox4TkoqECyDTCDvEM/Uet+hxqrJcdfH/AMDW8Z2dd70cJO24nYzMRXJq6Jp23bmD7B4sEMuepgLCjq8AADtPZsbXFBt/RLXN+Ah4Ve9QfZSLvQL6VJyHiajLKsrG5QKvzc1/thF6IIM8KtFxsyiInU5tBCsWgYfpB8kZmQJNAKUiCzSfyrKB1zgkM8jNxH1gaPWCbp38FCktIbgYh/0cEVZyr4MJdEW1G2DcFPAB/knXl65j16kw+Lb61wVip8nZUwCLJjFdqUf41iWS2BO07yDZhVubefJsRUdKgQYBR5RuciOXsW1IzyJ1WKbO/Xyfvl9EI3TXFDJvys7rQnEYinkB30sXQ0ATkYkKDt+MSXI5ji1zqfNnHYr0qqyRoCyRuavRVQUzTNlN0SMFPovxUk9wrPzYoUAHW/S2vLGZu3Wbxw2aIT5vkaChv1AmGChVMfX8Whx6+Q970PG0micPH+vnWBiwhus23cOamdba0dUNkulorRzDdipseig4Y04lj70Bq4Cr7pkWUX/sDcYY/7bjFNLL+7axcz1EX57VJViagIhrMNXWqoE/H0euMI5YexNeKn5OhsVE9NtTDeeJxBC9nxJ9M6Nqyhzk2e7PkLJcZmUV6Lv2VeSVKsaOScJJI03s02o2rrxVxMZpHOcjDtL+BbfHFBkorZHbanKAd8jRDeEz5tErbXFmF+wIh7+mMDI4OoTnmYueWJurzLCWXicIuk9fbNOHCzsVkY9bnauDIPMvUq8wbifHDiB+/QwfXa3rtxScQ+bF7RIY/hGOt/SjWRvWi8xgKjdcYWRy6MJOnZC8mnPs5QB3S54M/Eq/T11sPT+B9p94BfWMAzcsJXVhxMFPgxdq/xv4/z3a3SRASkwxyiQwxSAcmxuLazfZl62oLs1s7+NONM+QP80yOTZsBzMqBoTYC96Yk6Jhhhh26mVhnjLA2dwUZGV4/oIcue/jeUFmGGYu3ZmKyfSSrM2wKyyOc559n+ZlkNi7ylk2OLQKHDq2yTP96hWz+3h/7ICdMNekp1bHx9U/De8+qvjLys8g1e+CVTiNSJU3UWEGsRZ/BQc2ncnKp8fsoRl7Bj9z3MI50ZOWu8fej/kxCZxcFU4Tgc4yuZVKWRd8jTUFGOBHXW0biuGWfYOw0cRLhwtTTqnnOE3+/9V2dLFxEneyBz9GZmSEa/jLkMG9WgKn+QcjvmXYgQld+17EP6vGuiP633/PFj51R93QftiaGtURNu0zIPWYid1tSq8kkGmeZtNfZRDcNjUBulTrcYN0P+tjmPvJ+HeGIxCOHsPrS70sl+We6MP4TCFL74daPwmtMIFbbQqE2KQv538LYcKf8w4c/gp5WSn78ro9pfSqNBTZaFzg0mSMUXiYdTMoU6VQH9vWLHB6n6WKBzLGTv/YNE/8lPd+8KI9eeRlLlWlaf1uaWrP5O0CbzyTkDDzvJgUEZvuCtDZbwQjV8a799+i77xjGE88r6uuvo7L0FAoXmF46Oanp34OO28ZIufWjXKLwhMXdTIT9LhsbtTNOsHTr8lMtnGey2XvfMPZ+8n6tfL0DydwYls6+LPXzv8Pum7CUDBSjVxskWnK5Yb3n1DvlyOED6PLj+pN3/Qhef3wAV6/4LIsOtglOinTbRDfRoidmBMbehE3ZIhO4mycRMqPn1q9idn2ajze15rO6cOrswwjvW9dXI67lM8373RtJMEJ3NYM1hzU8Rfjz7gPvxniWiWa5JY3ZJzgeW1bya6wpayivLqB8juWMtLWXGER6P4cPHf24yslr+YIPlwm0WSVYiRGxjXVo666IbGdzeuuvvB8rL41JvW8QwdIcvHqBym5KZ9xDVzKi6VQMexm/tx+6Ffvj78KrcwmsU8gX5puYK2zCiwSIxpLIM8nJEPs2JjdtzOra0hVU8owPcv2+X2QYVuDbslc3Hd/uLJE/I7DUnmEUTdPheTclQbN8ZMeZLo6P7seJA1m5dpX5vs5mP79C3VWEOYSJzoAhdkSuaQYW0XJnkV/leNvpJVU4iMzEKD1kEOXXYygQBUbcBLZXIkx6ZqLu4JZ7D+sDHz2M1hLvOzct0eIKi1dT+rrTFH4vK8keEpoJLFHG2x5ky8ymdONbDV2jQLGuHOp7+fH1aeTnLiMoLcBpbsFpsdAHFSIbUvoBk5eG3IZdqDCoyJC6ZoAYTpJDMtdz7UjtRhlUqwL2NzE9kR3XXI6D3GnS9q0iKbpwEGI2u9RgBJel0BCKDj/Y7Bg4zEzOJoLqMkpvLKDKSc6B+47g4laa7sqpOnkDzlpkhYDKi9jWWW8Z6scd+3IYIQSi18l0wcWTs+QNeaaxO1TWOEX7xv9gX8afERYZjXfDv62OhddfJZCaoTapQIKkwK8Q9NRp5Jrl+aQteLtBD+OdcklbeDNGh2sUwEzJeaLuKsC1e12OxWbdkkInXz/Bydn+rj7Ms7pyZsZXVdhG2FUYS56oEzJIcNh9SYVKZmZ0a4Zc0ZkXo+g8ctjC6iRfUqKOyuxQN/i5pBCtN/pMKZcIqCqs5YOkHZlv5cp50ee/J5q8SIMy6uI10/ESyt4SxeLbRnhapU4GpsXexKfyQ8HbMN5gO7tNhN3FifYGQdvyZpvE5IAYvTVNpSbsK9shELODZ8MHrtY3EDunuPOnHdx/tQvVW9+nr55/jNl1m7WU9DRdzHbSlkWSkHl1Qi8SQ0WzFQnKi5zFT6BSjGMoolhlBBHQoZ/W3EPhe8wchG83GzdLzPCPEda2pkRjlxQJEi3lTaYYOliO9NoOA7Pm0ACNJX4k3+DvULGshYFxfaZ+u5li+xgNCQozoXfs0cwgXazgsdD1nagd5HgJTqSSacOBtT2AWvE50DbJ45mp8/infe9B33ZcPvYxumTX/TrR2yPPvvkiVoszVETRAFm7e0GXMsN5a1LHIQqka7luEn0DnRjbA3T0ujh9qoI9fXWJZKI6x+z+8pSHtyjokzwPGTcIm7xtKrxK48ZnSKVvhg1fnFrOdXPWQcKhUVmnsBTeDEaY5NSv3BjatueV4bTaaGBXeCO+Z5OeNa5RhJlEM/bdVIcGqeTNQIhknuHJ+LK16rp+duov9L98/keR/VnBQz8Xx6kHTug/XjiOySubcnVxDWuVMnYaLWmatpnscbIzpX2DGY6eYhg/4EhvVwkDXYuaZ2y/Pt2Np1/swvdmHJkl2yNUTGRE0Esus0U6bPoiURu9wN+gMTnUiFR9RMnQd8eiRNt06nEG33m+gHieCIOGrtrpEGxWDkLr2zbW1DmWcjsz4k8xWd6sU0TFDm7tFIt9CI3kZbPaSiZuVAGXLuLwRcTHrKFleXrmFf0ZTop/pX4f7n1HAtm7ST+T0Tn0wZiaBScN+lhyWjYZikmInMo0StvYWIljZSWuZ17sxMuM47Ugazc/XRJOLM3qdRE102kMAW8w10q/oxzisrDw/BS83mzYjdEoZ4T95NuXOXcJes0Ag9a3wtd+aETvh8LbdOaGMW6XKF2T0cTsFDjW/aPW+mb26MWT8LozcBI3VQGXMxNH4nbEzeG1VqnlM2tv4ReeuSJ7Xh/Wdz69D4c41hocdqSjrwUv46PJilCpRNiPO5haC3Btg4PJ7bzMb3AwUeBroqM4fvohpNazOHDA0Y0d9lB11QpVaMZ2xFBYy6vkSWaaUDZdaMNwDBy4Jkls9h4CnjNeGjXzQCY9tMd2NuaDMPZxYzXJLEvBLs25BHV0d14OKXxOqsTEvrgxipfQaLYX0e64NDz3hgKiJKIazP4+4gbL2c6ppVWptyoobG3K5PfPmiKpdifHAgmxZdFchloyLLtve0qzIJEQ1yEr5HbrznpR93Fgepiufo2fs7GlQjuiyqzfMuhum95geAmTwLy6+ISSfiSK2JCDzEkySEw0O6+vWuvDWB+t9tVezrDymyrHz1VzMrNHzHNSLMdY3bp+3AxwiYFoYGb/SE+WVxxN76ZeICrk+nhon3W9JRVWr7oaJPpyTRkAAAliSURBVGVqqtnQY8E1VFEYZtJG1YI2wmpXU1tqonahmTMbnrOC7YU89p4axTCNc4gJbZGJbocT3DoV4LPWljY0rNhxtpCZ8LHG+G4yxPO38DGZ4MZzm2Hyw+7cUm/UeZPt7AK1syt8+2Kis0sDPI9VQkydCBM0x2/xwS6J9ca0Ftw0GnM1gbjXR4Fp+aDMimonxIZGEttDt13PTozNepxYasGWWEsj2tXYtoI0XJokQBGXDHAk3pRYI6rHRondpwRrRU73+alVsluNdXoTB8rooBScCSin6yQEkLqTzQ/nC26R8V/bspnfxr69dldzdFd4hLtjnl2e3lVCGP9RWwLZiYkTTWmsrx/RvpQmhhMo5Fs3FBBnT50grjd8Tn2b5AGZYLN5aZzbaN3yae2FqPDD26syu2ArXHs3PItaoOSYlTm+v1WQrXoFkW1Pjt3u6JsvcXZIb66U+f6SWRXi8JmDU+RMn+La7wc0OVjtpQJeMwZfZAtYpQc0y+G6Dm6Uu91CZ9fn9Yb1zeK0WdFsW55lma4fTcNLdUlqqFejA0n0UgHrzXB73u4JJugiuVSvdpHyzqT28iydDPM0NZgwJLzYcZHVlRuurodLy/abEAZ0hBDEBLK2leHbEGrQA85fLmiKLj9EQfewPxpmF5bjvbL0+qSYPSn+b5RJZZhHGSVsPuhospetBxW5dpU8YpUw0q/o7q7SruXDo7sWfFnhzU+7Sxix7m8qm+vQ7SNJemFGk4ODiA+kpXdPhi13Qv1o60YZjKvX7E+nIi6za7UxinqDDApTsylJJt2hTR+oGThb3rVl5xHhInt7T9TGYyAh+0oCknP6ZrCD5e1VbMaH0L/gyVif6ITv2mWSTgOAhokGOVlq3RbVCmlz4e19TpheyPNzV8gcL3PcbL+WwilQ0GqP8Xet77a/M+CFgttWLiKuDQNmfyfOSVOcwC+NeGefpAd7kRnq1LGxFPZ0eqw2tp6GCkh67vJw0jmQMOSG3611/wCvqvh1BoFjltMl3Aa0UNdtJyTTEwThCk17dzdUAWsD791i3NZJd23XF/FqZb92v9aFvcfIFewX7DnI5ugwJ1oDgtWsylZKdDrt6foqb8WQfXu5gcSbs5xFkAluFCXcSm0C7XVxW+tNmeNPY/lQ8Kiay9l1e5Y+z2PZS2Slc2AIqVxG+0ZTODoSM3jCbMCsXFfALb2Rt+NN/8CxsYhWGp2okouv+xNokXP3mQvN134CDfP77pcVaJq2S+4qwbGbsuEaXZOApq5NvyjFBsfeL1/A8Y+fQieR2N0f4lsmSIIkxZZv02Zdpu7+ss/VxwnOypMldORLWHjmB8Q/LIG1klnTFcvaajj+CvuOtvWNxdUs015XggU9RglRM2zpHdJMV4d09ZEzHEvidLeD35sqorsn/vbWrgKODUUfP3e5+ZGHP+6RmopItdFN67EEkv9vMluy0zSsYSj4buazQWFRWRuSht8SMUoxBKtP4qrplxhSG1jMT+KzT3r45I8dkewKaTTmhDpnCNukzWaIU6bpaZPlQBx+Vm51HSt/+DyzJdVSZhKslw1brdf3MtvfG7KrSzYB2swvTjvrO1b4GKKc03d0j6Iz242ubEb3cG5xYthFF2/00swm+idy37q6q4CDufhXz55tfUGIzO65U1CsJkg8cGZnd20UG8VJsTuTNhHYdlNvlIBwVQ3tHjEsiEYnNVscTbrwObkx3zn6jS+t6cDhfZzz5SCDcdSJ+MjfoFAqqbe8IYUfzGDrEsHCJtvD4mbb+s1wEGOXUx04u3XfZHmyyVbo0PJ8juWOlo9E0shkh5FJ92pnij1KVwoHhiN6JwHZl6eIVGt+MNYpX78eAse/JOW/eG/tt1/4k8a/+uTvxPjZAYrFFKq1XjI5zEHMbdt6UfzGigbX52ptgvF6791qh4RjgVJgv0NQh11AM1t95Sr5+R1svD7LbpC8fYZ9Qtx8NY4DzxpZpso2zKaqVHYI+sqh5c2ust8W3ghuQ8A0PF7b8hFb/+22ARVhLB+JZNCRpeXTOXSy7R3MdGB/f1rvYpVZWWvhD1+cwdipwd9+cmCgfF0BNgz2xD49v+B/7InPNobf+4tR2VljPBbS9AQJ808isM1GuT5vvyyiux6g2uaYrSLCfGChEhMo3SZUhwHKNYvotLnJWQLZmG2vvXVqRt7s7prhSr622OW11/LDL2NoiPX1xrdDTAKUtvBGCexl1OwnxzkMSXWOSkdsgARLH/oTWezPduDOfhdxTpI+9egkiiOxhbHsyK/vyn1dAeN/ILU3PtL8ma89t/P04r+v6jvv7ZDj7OdrpYxNwi2zgxf1Lb4uN+Zo2d194bATg+WTgjAkrJPYbs0xqyiGGQoMnRbU7AaoHal5Tvu9euNbJ0bTZh3fb6/i72Z9G3tm58+1mMQIrxabmGyfJNan8IkcEskhyUQHtMftw7DXI+OJJE50e1pbb+GffXdS3xrmCP/uiZ/67rjUcB1O/dC/5x+qf/SrZza/vElrjffntOklZKYSYKGex3qDvF9zGeXmEj1hjucuh9XANLhmzU5ublPDhYvQMfTG13tkt5CE3/a43tRYgYObBHdCnG0Ua6cZ4beQTJlzTOwT7HgEOvFIN5KxPk1G+qQz2o/eaE73xntxsIvD0R7Bm40tfKV6ATu3ZXDwJyd+/Mzp7J/eLO//9YuTz97XfNejlwpf+v7mtZGaU2MnlUKdB67wv3xrBVV/na1rwUBm2z+ESmiEecAKb1CWGT+29Hrz4pjfta0UvWH967i+/eHB7jJ2iPTCFxpH9drWj5mkZ1v4iNuBmJdFwuvhrKAbnW5O+9xeSbue5nVHLmMJm2zdcyfGF/Y+MviTT30i+eIPy/o3fnX2Wx/Q2JW52me+s7D8ry9Wpp28rjGlsVts9wWtcEtXzSO1k9fd7xA0dxUQKkT89gaaUUDbO3aFl7Cu2A80PbZNonJjgy8svRoqwiiB9dOMqE3ZM42Ozf6GyzBf0CHjY/hIg0c8/i3eI93Do8Etp0d+yz2U+uy3f7m9G/v3VcDuvy/cuZRcrnZ9ZKpY/JHJ/Prx1cbqYMHfiNTMyjp79MASFY0wBNC2MNqEhVxP322BrYnDx851UA/c/PB6SEj7OS/8YoK2F7Tt745lewyIt9nfSUvEoTfEupuZbG6p90DPWx0D6ccyqe0/e/R3hyp/m3x/pwL+X//3fwAAAP//Fqb8bQAAAAZJREFUAwAeY/m5O/ZvZwAAAABJRU5ErkJggg==';
	const app = /** @type {HTMLElement} */ (document.getElementById('app'));
	app.innerHTML = `
		<header class="top">
			<img class="logo" src="${LOGO}" alt="" /><span class="dot" id="dot"></span><b id="project">NovaGame</b><span id="status" class="muted"></span>
			<span class="spacer"></span>
			<div class="transport">
				<button id="play" title="Lancer le jeu">${icon('play')}</button>
				<button id="pause" title="Pause">${icon('pause')}</button>
				<button id="stop" title="Arrêter">${icon('stop')}</button>
			</div>
			<button id="playHere" class="play-here" title="Jouer ici, au clavier et à la souris (Échap pour sortir)">${icon('gamepad')}<span>Jouer ici</span></button>
			<button id="adaptInput" class="ghost" hidden title="Ce jeu lit l'ancienne classe Input : Claude le passe au paquet Input System pour qu'il se joue depuis Orbit">Adapter le jeu</button>
			<span class="spacer"></span>
			<div class="seg" id="views"><button data-view="game" class="on">Jeu</button><button data-view="scene">Scène</button></div>
			<button id="select" class="select" title="Cliquer un objet dans la vue (S)"><span class="cursor"></span>Sélectionner</button>
			<button id="save" class="ghost" title="Enregistrer la scène">Enregistrer</button>
			<button id="refresh" class="ghost" title="Réimporter et recompiler les scripts">Recompiler</button>
		</header>
		<div class="offline" id="offline" hidden></div>
		<div class="body" id="body">
			<aside class="hierarchy">
				<div class="pane-head"><span>Hiérarchie</span><select id="create" title="Créer un objet"><option value="">+ Objet</option>${CREATE.map(c => `<option>${c}</option>`).join('')}</select></div>
				<input id="search" class="search" placeholder="Rechercher…" spellcheck="false" />
				<ul id="tree" class="tree"></ul>
			</aside>
			<main class="viewport" id="viewport" tabindex="-1">
				<img id="frame" alt="" draggable="false" />
				<div class="frame-hint" id="frameHint"></div>
				<div class="badge-play" id="playBadge" hidden>EN JEU</div>
				<div class="play-hint" id="playHint" hidden></div>
			</main>
			<aside class="inspector" id="inspector"><div class="empty muted">Sélectionne un objet dans la hiérarchie ou dans la vue.</div></aside>
		</div>
		<section class="console" id="console">
			<div class="pane-head"><span>Console</span><span id="counts" class="muted"></span><span class="spacer"></span>
				<div class="seg small"><button data-filter="all" class="on">Tout</button><button data-filter="error">Erreurs</button></div>
				<button id="clear" class="ghost small">Effacer</button></div>
			<ul id="logs" class="logs"></ul>
		</section>
		<footer class="claude">
			<span class="claude-mark" title="Claude"></span>
			<input id="ask" placeholder="Demande à Claude : il voit le jeu et modifie la scène (« ajoute un saut au joueur », « fais tomber la caisse »…)" spellcheck="false" />
			<button id="send" class="primary"><span class="claude-mark light"></span> Envoyer à Claude</button>
		</footer>
		<div id="toast" class="toast" hidden></div>`;

	const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
	/** @type {{ base: string, token: string } | undefined} */
	let bridge;
	let installed = true;
	let view = 'game';
	let selecting = false;
	let selectedId = 0;
	/** @type {any} */
	let inspected;
	let version = -1;
	let logIndex = 0;
	/** @type {any[]} */
	let logs = [];
	let logFilter = 'all';
	/** @type {any[]} */
	let tree = [];
	const collapsed = new Set();
	let frameBusy = false;
	let online = false;
	/** Playing from Orbit: keys and mouse held over the game view go to the game. */
	let capture = false;
	let captureSawPlaying = false;
	let inputSupported = true;
	let inputBusy = false;
	let inputDirty = false;
	let inputWarned = false;
	let bridgeUpdating = false;
	/** The bridge version this page talks to: an older one in the project is replaced on sight. */
	const BRIDGE_VERSION = '1.2.0';
	/** @type {Set<string>} */
	const keysDown = new Set();
	const pointer = { x: 0.5, y: 0.5, dx: 0, dy: 0, scroll: 0, buttons: 0 };

	function toast(/** @type {string} */ text, error = false) {
		const t = $('toast');
		t.textContent = text;
		t.className = `toast${error ? ' error' : ''}`;
		t.hidden = false;
		clearTimeout(t._timer);
		t._timer = setTimeout(() => { t.hidden = true; }, error ? 6000 : 3000);
	}

	/** Call the Unity bridge directly from the page. */
	async function call(/** @type {string} */ route, /** @type {Record<string, any>} */ params = {}) {
		if (!bridge) {
			throw new Error('Unity n\'est pas connecté');
		}
		const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])), token: bridge.token });
		const res = await fetch(`${bridge.base}${route}?${query}`);
		const json = await res.json();
		if (!res.ok) {
			throw new Error(json.error || `Erreur ${res.status}`);
		}
		return json;
	}

	const act = (/** @type {string} */ route, /** @type {Record<string, any>} */ params = {}) => call(route, params).catch(err => toast(err.message, true));

	// --- connection

	function setOnline(/** @type {boolean} */ value, /** @type {string} */ reason = '') {
		online = value;
		$('dot').className = `dot ${value ? 'on' : ''}`;
		$('body').classList.toggle('dim', !value);
		const off = $('offline');
		off.hidden = value;
		if (!value) {
			off.innerHTML = !installed
				? `<b>Ce projet n'a pas encore le pont Orbit.</b> Il ajoute un petit paquet d'éditeur (rien dans tes builds) qui relie Unity à Orbit.<button id="install" class="primary">Installer le pont</button>`
				: `<b>Unity n'est pas connecté.</b> ${escape(reason || 'Ouvre ce projet dans Unity : le Studio se connecte tout seul.')}<button id="openUnity" class="primary">Ouvrir dans Unity</button>`;
			$('install')?.addEventListener('click', () => vscode.postMessage({ type: 'install' }));
			$('openUnity')?.addEventListener('click', () => vscode.postMessage({ type: 'openUnity' }));
		}
	}

	async function poll() {
		if (bridge) {
			try {
				const state = await call('/state');
				if (!online) {
					setOnline(true);
					version = -1;
				}
				$('status').textContent = `${state.scene || 'Scène sans titre'}${state.dirty ? ' · non enregistrée' : ''}${state.compiling ? ' · compilation…' : ''}`;
				$('play').classList.toggle('on', state.playing);
				$('pause').classList.toggle('on', state.paused);
				$('playBadge').hidden = !state.playing;
				document.body.classList.toggle('playing', state.playing);
				if (state.bridge !== BRIDGE_VERSION && !state.playing && !state.compiling) {
					updateBridge();
				}
				inputSupported = state.bridge === BRIDGE_VERSION && state.input !== false;
				$('adaptInput').hidden = !(state.bridge === BRIDGE_VERSION && state.input === false);
				if (capture) {
					if (state.playing) {
						captureSawPlaying = true;
					} else if (captureSawPlaying) {
						setCapture(false);
					}
					showPlayHint();
				}
				if (state.version !== version) {
					version = state.version;
					tree = await call('/hierarchy');
					renderTree();
				}
				if (state.selection && state.selection !== selectedId) {
					select(state.selection, false);
				} else if (selectedId && !inspected) {
					inspect();
				}
				if (state.logs < logIndex) {
					logIndex = 0; // the editor restarted
					logs = [];
				}
				if (state.logs > logIndex) {
					const result = await call('/logs', { since: logIndex });
					logs.push(...result.entries);
					logIndex = result.total;
					renderLogs();
				}
			} catch (err) {
				setOnline(false, /busy/.test(String(err)) ? 'Unity est occupé (compilation ou import)…' : '');
			}
		} else {
			setOnline(false);
		}
		setTimeout(poll, 700);
	}

	// --- live view

	function nextFrame() {
		const img = /** @type {HTMLImageElement} */ ($('frame'));
		if (!bridge || !online || frameBusy || document.hidden) {
			setTimeout(nextFrame, 400);
			return;
		}
		frameBusy = true;
		const box = $('viewport').getBoundingClientRect();
		// While playing, frames come as fast as Unity gives them: lighter images, no pause in between.
		const scale = capture ? Math.min(1, 1280 / box.width) : Math.min(devicePixelRatio, 1.5);
		const w = Math.max(64, Math.round(box.width * scale));
		const h = Math.max(64, Math.round(box.height * scale));
		const loader = new Image();
		loader.onload = () => {
			img.src = loader.src;
			img.dataset.w = String(w);
			img.dataset.h = String(h);
			$('frameHint').textContent = '';
			frameBusy = false;
			setTimeout(nextFrame, capture ? 0 : 90);
		};
		loader.onerror = () => {
			$('frameHint').textContent = 'Aucune caméra à afficher.';
			frameBusy = false;
			setTimeout(nextFrame, 1500);
		};
		loader.src = `${bridge.base}/frame?view=${view}&w=${w}&h=${h}&q=${capture ? 62 : 85}&token=${bridge.token}&t=${Date.now()}`;
	}

	// --- playing from Orbit

	/** KeyboardEvent.code to the Input System's Key name: both name the physical key. */
	const KEY_NAMES = /** @type {Record<string, string>} */ ({
		ShiftLeft: 'LeftShift', ShiftRight: 'RightShift', ControlLeft: 'LeftCtrl', ControlRight: 'RightCtrl', AltLeft: 'LeftAlt', AltRight: 'RightAlt',
		ArrowUp: 'UpArrow', ArrowDown: 'DownArrow', ArrowLeft: 'LeftArrow', ArrowRight: 'RightArrow',
		BracketLeft: 'LeftBracket', BracketRight: 'RightBracket', Backquote: 'Backquote', IntlBackslash: 'OEM1',
		NumpadEnter: 'NumpadEnter', NumpadAdd: 'NumpadPlus', NumpadSubtract: 'NumpadMinus', NumpadMultiply: 'NumpadMultiply', NumpadDivide: 'NumpadDivide', NumpadDecimal: 'NumpadPeriod',
	});
	/** Asks Orbit to put its current bridge in the project; Unity then recompiles it. */
	function updateBridge() {
		if (bridgeUpdating) {
			return;
		}
		bridgeUpdating = true;
		toast('Mise à jour du pont Orbit dans ce projet… Unity recompile quelques secondes.');
		vscode.postMessage({ type: 'install' });
		setTimeout(() => act('/refresh'), 1500);
		setTimeout(() => { bridgeUpdating = false; }, 60000);
	}
	function keyName(/** @type {string} */ code) {
		return KEY_NAMES[code] ?? (code.startsWith('Key') ? code.slice(3) : code);
	}

	function showPlayHint() {
		const hint = $('playHint');
		hint.hidden = !capture;
		if (!capture) {
			return;
		}
		hint.textContent = !captureSawPlaying
			? 'Le jeu démarre…'
			: !inputSupported
				? 'Ce jeu ne reçoit pas encore les touches d\'Orbit : il lui faut le paquet Input System. Bouton « Adapter le jeu » en haut.'
				: document.pointerLockElement
					? 'Échap : libérer la souris'
					: 'Clique dans le jeu pour prendre la souris · Échap : quitter le mode jeu';
		hint.classList.toggle('warn', captureSawPlaying && !inputSupported);
	}

	function sendInput() {
		if (!capture || !captureSawPlaying || !inputSupported || !online) {
			return;
		}
		if (inputBusy) {
			inputDirty = true;
			return;
		}
		inputBusy = true;
		inputDirty = false;
		const params = { keys: [...keysDown].join(','), buttons: pointer.buttons, x: pointer.x.toFixed(4), y: pointer.y.toFixed(4), dx: pointer.dx.toFixed(2), dy: pointer.dy.toFixed(2), scroll: pointer.scroll };
		pointer.dx = pointer.dy = pointer.scroll = 0;
		call('/input', params).catch(err => {
			if (!inputWarned && !/not playing|busy|fetch/i.test(String(err))) {
				inputWarned = true;
				toast(err.message, true);
			}
		}).finally(() => {
			inputBusy = false;
			if (inputDirty) {
				sendInput();
			}
		});
	}

	async function setCapture(/** @type {boolean} */ value) {
		if (capture === value) {
			return;
		}
		capture = value;
		document.body.classList.toggle('capture', value);
		$('playHere').classList.toggle('on', value);
		$('playHere').querySelector('span').textContent = value ? 'Quitter le jeu' : 'Jouer ici';
		keysDown.clear();
		pointer.buttons = 0;
		if (value) {
			setSelecting(false);
			captureSawPlaying = $('play').classList.contains('on');
			inputWarned = false;
			view = 'game';
			document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.getAttribute('data-view') === 'game'));
			$('viewport').focus();
			if (!captureSawPlaying) {
				act('/play');
			}
		} else {
			if (document.pointerLockElement) {
				document.exitPointerLock();
			}
			if (online && inputSupported) {
				call('/input', { release: 1 }).catch(() => { /* the game stopped: nothing left to release */ });
			}
		}
		showPlayHint();
	}

	$('adaptInput').addEventListener('click', () => {
		vscode.postMessage({
			type: 'ask',
			instruction: 'Fais passer ce jeu au paquet Input System pour qu\'on puisse y jouer depuis Orbit. 1) Ajoute "com.unity.inputsystem" à Packages/manifest.json (1.11.2 pour Unity 6, 1.7.0 avant). 2) Dans ProjectSettings/ProjectSettings.asset, mets activeInputHandler à 2 : fais-le Unity fermé, sinon Unity ouvre une fenêtre bloquante. 3) Remplace chaque appel à l\'ancienne classe Input (Input.GetKey, GetAxis, GetMouseButton, mousePosition…) par Keyboard.current / Mouse.current du namespace UnityEngine.InputSystem, en gardant le même comportement. 4) Rouvre le projet dans Unity et vérifie la console.',
		});
	});
	$('playHere').addEventListener('click', () => {
		if (!capture && !online) {
			// Nothing to play yet: Unity has to be running on the game first.
			toast(installed ? 'Unity n\'est pas ouvert sur ce jeu : Orbit le lance, le jeu s\'affiche dès qu\'il est prêt.' : 'Installe d\'abord le pont Orbit dans ce projet.');
			if (installed) {
				vscode.postMessage({ type: 'openUnity' });
			}
			return;
		}
		setCapture(!capture);
	});
	$('viewport').addEventListener('mousedown', (/** @type {MouseEvent} */ e) => {
		if (!capture) {
			return;
		}
		e.preventDefault();
		$('viewport').focus();
		if (!document.pointerLockElement) {
			$('viewport').requestPointerLock();
		}
		pointer.buttons |= e.button === 0 ? 1 : e.button === 2 ? 2 : 4;
		sendInput();
	});
	document.addEventListener('mouseup', e => {
		if (capture) {
			pointer.buttons &= ~(e.button === 0 ? 1 : e.button === 2 ? 2 : 4);
			sendInput();
		}
	});
	$('viewport').addEventListener('mousemove', (/** @type {MouseEvent} */ e) => {
		if (!capture) {
			return;
		}
		if (document.pointerLockElement) {
			pointer.dx += e.movementX;
			pointer.dy += e.movementY;
		} else {
			const r = $('frame').getBoundingClientRect();
			const x = (e.clientX - r.left) / r.width;
			const y = (e.clientY - r.top) / r.height;
			pointer.dx += (x - pointer.x) * r.width;
			pointer.dy += (y - pointer.y) * r.height;
			pointer.x = x;
			pointer.y = y;
		}
		sendInput();
	});
	$('viewport').addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
		if (capture) {
			e.preventDefault();
			pointer.scroll -= Math.sign(e.deltaY) * 120;
			sendInput();
		}
	}, { passive: false });
	$('viewport').addEventListener('contextmenu', (/** @type {Event} */ e) => capture && e.preventDefault());
	document.addEventListener('pointerlockchange', showPlayHint);
	window.addEventListener('blur', () => {
		if (capture && keysDown.size) {
			keysDown.clear();
			pointer.buttons = 0;
			sendInput();
		}
	});
	document.addEventListener('keyup', e => {
		if (capture && keysDown.delete(keyName(e.code))) {
			e.preventDefault();
			sendInput();
		}
	});

	$('viewport').addEventListener('click', async (/** @type {MouseEvent} */ e) => {
		if (!selecting || !online) {
			return;
		}
		const img = /** @type {HTMLImageElement} */ ($('frame'));
		const r = img.getBoundingClientRect();
		const result = await call('/pick', { view, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: img.dataset.w, h: img.dataset.h }).catch(err => toast(err.message, true));
		if (result?.id) {
			select(result.id, false);
		} else if (result) {
			toast('Rien ici : clique sur un objet visible.');
		}
	});

	// --- hierarchy

	function renderTree() {
		const q = $('search').value.trim().toLowerCase();
		const matches = (/** @type {any} */ n) => !q || n.name.toLowerCase().includes(q) || n.children.some(matches);
		const html = (/** @type {any[]} */ nodes, /** @type {number} */ depth) => nodes.filter(matches).map(n => {
			const open = !collapsed.has(n.id) || !!q;
			return `<li>
				<div class="row ${n.id === selectedId ? 'on' : ''} ${n.active ? '' : 'inactive'}" data-id="${n.id}" style="padding-left:${8 + depth * 14}px">
					<span class="twist" data-twist="${n.id}">${n.children.length ? icon(open ? 'chevronDown' : 'chevronRight') : ''}</span>
					<span class="kind ${n.kind}">${icon(KIND_ICONS[n.kind] ?? 'empty')}</span><span class="name">${escape(n.name)}</span>
				</div>
				${n.children.length && open ? `<ul>${html(n.children, depth + 1)}</ul>` : ''}
			</li>`;
		}).join('');
		$('tree').innerHTML = html(tree, 0) || '<li class="muted empty">Scène vide</li>';
	}

	function select(/** @type {number} */ id, /** @type {boolean} */ tellUnity) {
		selectedId = id;
		inspected = undefined;
		renderTree();
		if (tellUnity) {
			act('/select', { id });
		}
		inspect();
	}

	// --- inspector

	async function inspect() {
		if (!selectedId) {
			return;
		}
		try {
			inspected = await call('/inspect', { id: selectedId });
			renderInspector();
		} catch {
			inspected = undefined;
			selectedId = 0;
			$('inspector').innerHTML = '<div class="empty muted">Objet introuvable (supprimé ?).</div>';
		}
	}

	const num = (/** @type {number} */ v) => Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
	const hex = (/** @type {number[]} */ c) => `#${c.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

	function field(/** @type {any} */ p, /** @type {number} */ comp) {
		const attrs = `data-comp="${comp}" data-path="${escape(p.path)}" data-kind="${p.kind}" ${p.readonly ? 'disabled' : ''}`;
		switch (p.kind) {
			case 'bool': return `<input type="checkbox" ${attrs} ${p.value ? 'checked' : ''} />`;
			case 'int': case 'float': return `<input class="num" ${attrs} value="${num(p.value)}" />`;
			case 'string': return `<input ${attrs} value="${escape(p.value ?? '')}" />`;
			case 'vector': case 'rotation':
				return `<div class="vec" ${attrs}>${p.value.map((/** @type {number} */ v, /** @type {number} */ i) => `<label><i>${'xyzw'[i]}</i><input class="num" data-i="${i}" value="${num(v)}" ${p.readonly ? 'disabled' : ''} /></label>`).join('')}</div>`;
			case 'color': return `<div class="color" ${attrs}><input type="color" value="${hex(p.value)}" ${p.readonly ? 'disabled' : ''} /><input class="num alpha" value="${num(p.value[3])}" title="Opacité" ${p.readonly ? 'disabled' : ''} /></div>`;
			case 'enum': return `<select ${attrs}>${p.options.map((/** @type {string} */ o, /** @type {number} */ i) => `<option value="${i}" ${i === p.value ? 'selected' : ''}>${escape(o)}</option>`).join('')}</select>`;
			default: return `<span class="ro" title="${escape(String(p.value ?? ''))}">${escape(String(p.value ?? '—'))}</span>`;
		}
	}

	function renderInspector() {
		const o = inspected;
		if (!o) {
			return;
		}
		$('inspector').innerHTML = `
			<div class="obj-head">
				<input type="checkbox" data-comp="-1" data-path="m_IsActive" data-kind="bool" ${o.active ? 'checked' : ''} title="Actif" />
				<input class="obj-name" data-comp="-1" data-path="m_Name" data-kind="string" value="${escape(o.name)}" />
				<button class="ghost icon" id="delete" title="Supprimer l'objet">${icon('trash')}</button>
			</div>
			<div class="obj-meta muted">${escape(o.path)} · ${escape(o.tag)} · ${escape(o.layer)}</div>
			${o.components.map((/** @type {any} */ c) => `
				<details class="comp" open>
					<summary><span class="ctype">${escape(c.type)}</span>${c.script ? `<button class="link" data-script="${escape(c.script)}" data-class="${escape(c.type)}">ouvrir le script</button>` : ''}${c.type !== 'Transform' ? `<button class="x" data-remove="${c.index}" title="Retirer">${icon('close')}</button>` : ''}</summary>
					${c.properties.map((/** @type {any} */ p) => `<div class="prop"><span class="label" title="${escape(p.path)}">${escape(p.label)}</span>${field(p, c.index)}</div>`).join('')}
				</details>`).join('')}
			<div class="add-comp"><input id="newComp" placeholder="Ajouter un composant (Rigidbody, BoxCollider, AudioSource…)" spellcheck="false" /></div>`;
	}

	/** Read an edited field back into the bridge's value format. */
	function valueOf(/** @type {HTMLElement} */ el) {
		const kind = el.getAttribute('data-kind');
		if (kind === 'bool') {
			return /** @type {HTMLInputElement} */ (el).checked ? 'true' : 'false';
		}
		if (kind === 'vector' || kind === 'rotation') {
			return [...el.querySelectorAll('input')].map(i => i.value.replace(',', '.')).join(',');
		}
		if (kind === 'color') {
			const [color, alpha] = el.querySelectorAll('input');
			const h = color.value;
			return [1, 3, 5].map(i => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)).concat(alpha.value.replace(',', '.')).join(',');
		}
		const raw = /** @type {HTMLInputElement} */ (el).value;
		return kind === 'float' || kind === 'int' ? raw.replace(',', '.') : raw;
	}

	async function commit(/** @type {HTMLElement} */ el) {
		const holder = /** @type {HTMLElement} */ (el.closest('[data-path]'));
		if (!holder || !selectedId) {
			return;
		}
		try {
			await call('/set', { id: selectedId, comp: holder.getAttribute('data-comp'), path: holder.getAttribute('data-path'), value: valueOf(holder) });
		} catch (err) {
			toast(/** @type {Error} */ (err).message, true);
		}
		inspect();
	}

	$('inspector').addEventListener('change', (/** @type {Event} */ e) => commit(/** @type {HTMLElement} */ (e.target)));
	$('inspector').addEventListener('keydown', async (/** @type {KeyboardEvent} */ e) => {
		const target = /** @type {HTMLInputElement} */ (e.target);
		if (e.key === 'Enter' && target.id === 'newComp' && target.value.trim()) {
			const result = await act('/addComponent', { id: selectedId, type: target.value.trim() });
			if (result) {
				toast(`${target.value.trim()} ajouté`);
			}
			inspect();
		} else if (e.key === 'Enter' && target.matches('input:not([type=checkbox])')) {
			target.blur();
		}
	});
	$('inspector').addEventListener('click', async (/** @type {MouseEvent} */ e) => {
		const target = /** @type {HTMLElement} */ (e.target);
		const script = target.closest('[data-script]');
		if (script) {
			e.preventDefault();
			vscode.postMessage({ type: 'openScript', file: script.getAttribute('data-script'), className: script.getAttribute('data-class') });
			return;
		}
		const remove = target.closest('[data-remove]');
		if (remove) {
			e.preventDefault();
			await act('/removeComponent', { id: selectedId, comp: remove.getAttribute('data-remove') });
			inspect();
			return;
		}
		if (target.id === 'delete') {
			await act('/delete', { id: selectedId });
			selectedId = 0;
			inspected = undefined;
			$('inspector').innerHTML = '<div class="empty muted">Objet supprimé (Ctrl+Z dans Unity pour annuler).</div>';
		}
	});

	// --- console

	function renderLogs() {
		const errors = logs.filter(l => l.type === 'error').length;
		const warnings = logs.filter(l => l.type === 'warning').length;
		$('counts').innerHTML = `<span class="err"><i class="status-dot"></i> ${errors}</span> <span class="warn"><i class="status-dot"></i> ${warnings}</span> <span><i class="status-dot"></i> ${logs.length - errors - warnings}</span>`;
		const shown = (logFilter === 'error' ? logs.filter(l => l.type === 'error') : logs).slice(-300);
		$('logs').innerHTML = shown.map(l => `<li class="${l.type}" data-log="${l.index}">
			<span class="t">${escape(l.time ?? '')}</span>
			<span class="m">${escape(String(l.message).split('\n')[0])}</span>
			${l.file ? `<button class="link" data-open="${l.index}">${escape(String(l.file).split(/[\\/]/).pop())}:${l.line}</button>` : ''}
			${l.type === 'error' ? `<button class="fix" data-fix="${l.index}">Corriger avec Claude</button>` : ''}
		</li>`).join('') || '<li class="muted empty">Rien pour l\'instant.</li>';
		$('logs').scrollTop = $('logs').scrollHeight;
	}

	$('logs').addEventListener('click', (/** @type {MouseEvent} */ e) => {
		const target = /** @type {HTMLElement} */ (e.target);
		const open = target.closest('[data-open]');
		const fix = target.closest('[data-fix]');
		const log = logs.find(l => String(l.index) === (open || fix)?.getAttribute(open ? 'data-open' : 'data-fix'));
		if (open && log) {
			vscode.postMessage({ type: 'openScript', file: log.file, line: log.line });
		} else if (fix && log) {
			vscode.postMessage({ type: 'fix', log });
		}
	});

	// --- toolbar and events

	function setSelecting(/** @type {boolean} */ value) {
		selecting = value;
		$('select').classList.toggle('on', value);
		$('viewport').classList.toggle('picking', value);
	}

	document.addEventListener('click', e => {
		const target = /** @type {HTMLElement} */ (e.target);
		const viewButton = target.closest('[data-view]');
		if (viewButton) {
			view = viewButton.getAttribute('data-view') ?? 'game';
			document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b === viewButton));
			return;
		}
		const filter = target.closest('[data-filter]');
		if (filter) {
			logFilter = filter.getAttribute('data-filter') ?? 'all';
			document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('on', b === filter));
			renderLogs();
			return;
		}
		const twist = target.closest('[data-twist]');
		if (twist) {
			const id = Number(twist.getAttribute('data-twist'));
			collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
			renderTree();
			return;
		}
		const row = target.closest('#tree [data-id]');
		if (row) {
			select(Number(row.getAttribute('data-id')), true);
		}
	});
	$('tree').addEventListener('dblclick', (/** @type {MouseEvent} */ e) => {
		const row = /** @type {HTMLElement} */ (e.target).closest('[data-id]');
		if (row) {
			act('/focus', { id: row.getAttribute('data-id') });
		}
	});
	$('play').addEventListener('click', () => act('/play'));
	$('pause').addEventListener('click', () => act('/pause'));
	$('stop').addEventListener('click', () => act('/stop'));
	$('save').addEventListener('click', async () => { if (await act('/save')) { toast('Scène enregistrée'); } });
	$('refresh').addEventListener('click', async () => { if (await act('/refresh')) { toast('Recompilation lancée'); } });
	$('select').addEventListener('click', () => setSelecting(!selecting));
	$('search').addEventListener('input', renderTree);
	$('clear').addEventListener('click', async () => { await act('/clearLogs'); logs = []; logIndex = 0; renderLogs(); });
	$('create').addEventListener('change', async () => {
		const primitive = $('create').value;
		$('create').value = '';
		if (primitive) {
			const result = await act('/create', { name: primitive === 'Empty' ? 'GameObject' : primitive, primitive, position: '0,0.5,0' });
			if (result?.id) {
				select(result.id, false);
			}
		}
	});
	const send = () => {
		const instruction = $('ask').value.trim();
		if (!instruction) {
			$('ask').focus();
			return;
		}
		vscode.postMessage({ type: 'ask', instruction, selection: inspected && { id: inspected.id, path: inspected.path, components: inspected.components.map((/** @type {any} */ c) => ({ type: c.type, script: c.script })) } });
		$('ask').value = '';
	};
	$('send').addEventListener('click', send);
	$('ask').addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') { send(); } });
	document.addEventListener('keydown', e => {
		const typing = /** @type {HTMLElement} */ (e.target).closest('input, textarea, select');
		if (capture && !typing) {
			// The first Escape frees the mouse (the browser keeps that one), the next leaves the game mode.
			if (e.key === 'Escape') {
				setCapture(false);
			} else if (e.code) {
				e.preventDefault();
				e.stopPropagation();
				if (!e.repeat) {
					keysDown.add(keyName(e.code));
					sendInput();
				}
			}
			return;
		}
		if (e.key === 'Escape') {
			setSelecting(false);
		} else if (!typing && e.key.toLowerCase() === 's') {
			setSelecting(!selecting);
		}
	});

	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg?.type === 'bridge') {
			installed = msg.installed;
			$('project').textContent = msg.project;
			const changed = JSON.stringify(msg.bridge) !== JSON.stringify(bridge);
			bridge = msg.bridge || undefined;
			if (changed) {
				version = -1;
			}
			if (!bridge) {
				setOnline(false);
			}
		} else if (msg?.type === 'sent') {
			toast(`Envoyé à ${msg.terminal}`);
		}
	});

	setOnline(false);
	poll();
	nextFrame();
	vscode.postMessage({ type: 'ready' });
})();
